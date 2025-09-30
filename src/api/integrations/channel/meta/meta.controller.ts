import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import axios from 'axios';

import { ChannelController, ChannelControllerInterface } from '../channel.controller';

export class MetaController extends ChannelController implements ChannelControllerInterface {
  private readonly logger = new Logger('MetaController');

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    super(prismaRepository, waMonitor);
  }

  integrationEnabled: boolean;

  public async receiveWebhook(data: any) {
    this.logger.log(`Webhook received: ${JSON.stringify(data, null, 2)}`);
    
    if (data.object === 'whatsapp_business_account') {
      if (data.entry[0]?.changes[0]?.field === 'message_template_status_update') {
        const templateId = data.entry[0].changes[0].value.message_template_id;
        
        this.logger.log(`Template status update webhook received for templateId: ${templateId}`);
        this.logger.log(`Template status data: ${JSON.stringify(data.entry[0].changes[0].value, null, 2)}`);
        
        // Log all templates in database for debugging
        const allTemplates = await this.prismaRepository.template.findMany({
          select: { templateId: true, name: true, webhookUrl: true, instanceId: true }
        });
        this.logger.log(`All templates in database: ${JSON.stringify(allTemplates, null, 2)}`);
        
        const template = await this.prismaRepository.template.findFirst({
          where: { templateId: `${templateId}` },
        });

        if (!template) {
          this.logger.error(`Template not found for templateId: ${templateId}`);
          this.logger.error(`Available templates: ${allTemplates.map(t => `${t.name}: ${t.templateId} (webhook: ${t.webhookUrl ? 'YES' : 'NO'})`).join(', ')}`);
          return;
        }

        this.logger.log(`Template found: ${JSON.stringify(template, null, 2)}`);
        
        const { webhookUrl } = template;
        
        if (!webhookUrl) {
          this.logger.error(`Webhook URL not configured for template: ${template.name} (ID: ${template.templateId})`);
          return;
        }

        this.logger.log(`Sending webhook to: ${webhookUrl}`);
        
        try {
          await axios.post(webhookUrl, data.entry[0].changes[0].value, {
            headers: {
              'Content-Type': 'application/json',
            },
          });
          this.logger.log(`Webhook sent successfully to: ${webhookUrl}`);
        } catch (error) {
          this.logger.error(`Failed to send webhook to ${webhookUrl}: ${error.response?.data || error.message}`);
        }
        return;
      }

      data.entry?.forEach(async (entry: any) => {
        const numberId = entry.changes[0].value.metadata.phone_number_id;

        this.logger.log(`Processing webhook entry: ${JSON.stringify(entry, null, 2)}`);
        this.logger.log(`Number ID from webhook: ${numberId}`);
        this.logger.log(`Number ID type: ${typeof numberId}`);

        if (!numberId) {
          this.logger.error('WebhookService -> receiveWebhookMeta -> numberId not found');
          return {
            status: 'success',
          };
        }

        // Log all instances in database for debugging
        const allInstances = await this.prismaRepository.instance.findMany({
          select: { name: true, number: true, integration: true, updatedAt: true }
        });
        this.logger.log(`All instances in database: ${JSON.stringify(allInstances, null, 2)}`);

        // Try multiple search approaches
        const instance = await this.prismaRepository.instance.findFirst({
          where: { number: numberId },
        });

        // Also try searching by name
        const instanceByName = await this.prismaRepository.instance.findFirst({
          where: { name: 'TransacionalRenovabe' },
        });

        this.logger.log(`Found instance by number: ${JSON.stringify(instance, null, 2)}`);
        this.logger.log(`Found instance by name: ${JSON.stringify(instanceByName, null, 2)}`);
        this.logger.log(`Searching for numberId: ${numberId} (type: ${typeof numberId})`);

        if (!instance) {
          this.logger.error(`WebhookService -> receiveWebhookMeta -> instance not found for numberId: ${numberId}`);
          this.logger.error(`Available instances: ${allInstances.map(i => `${i.name}: ${i.number} (${i.integration})`).join(', ')}`);
          return {
            status: 'success',
          };
        }

        // Check if instance exists in memory
        this.logger.log(`Available instances in memory: ${Object.keys(this.waMonitor.waInstances).join(', ')}`);
        
        if (!this.waMonitor.waInstances[instance.name]) {
          this.logger.error(`Instance ${instance.name} not found in waMonitor.waInstances`);
          this.logger.log(`Trying to reload instance from database...`);
          
          // Try to reload the instance
          try {
            await this.waMonitor.loadInstance();
            this.logger.log(`Instance reloaded. Available instances: ${Object.keys(this.waMonitor.waInstances).join(', ')}`);
          } catch (error) {
            this.logger.error(`Failed to reload instance: ${error}`);
          }
          
          if (!this.waMonitor.waInstances[instance.name]) {
            return {
              status: 'success',
            };
          }
        }

        await this.waMonitor.waInstances[instance.name].connectToWhatsapp(data);

        return {
          status: 'success',
        };
      });
    }

    return {
      status: 'success',
    };
  }
}
