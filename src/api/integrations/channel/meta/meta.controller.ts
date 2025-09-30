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
        const template = await this.prismaRepository.template.findFirst({
          where: { templateId: `${data.entry[0].changes[0].value.message_template_id}` },
        });

        if (!template) {
          console.log('template not found');
          return;
        }

        const { webhookUrl } = template;

        await axios.post(webhookUrl, data.entry[0].changes[0].value, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
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
          select: { name: true, number: true, integration: true }
        });
        this.logger.log(`All instances in database: ${JSON.stringify(allInstances, null, 2)}`);

        const instance = await this.prismaRepository.instance.findFirst({
          where: { number: numberId },
        });

        this.logger.log(`Found instance: ${JSON.stringify(instance, null, 2)}`);

        if (!instance) {
          this.logger.error(`WebhookService -> receiveWebhookMeta -> instance not found for numberId: ${numberId}`);
          this.logger.error(`Available instances: ${allInstances.map(i => `${i.name}: ${i.number} (${i.integration})`).join(', ')}`);
          return {
            status: 'success',
          };
        }

        // Check if instance exists in memory
        if (!this.waMonitor.waInstances[instance.name]) {
          this.logger.error(`Instance ${instance.name} not found in waMonitor.waInstances`);
          this.logger.log(`Available instances in memory: ${Object.keys(this.waMonitor.waInstances).join(', ')}`);
          return {
            status: 'success',
          };
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
