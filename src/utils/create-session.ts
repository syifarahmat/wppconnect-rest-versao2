import { Ack, create, SocketState, LiveLocation, Message, ParticipantEvent, PresenceEvent, CreateOptions, Whatsapp } from "@wppconnect-team/wppconnect";
import FileTokenStore from "../stores/FileTokenStore";
import config from "../config";
import { ClientWhatsApp, RequestEx, Sessions } from "../models/Request";
import { clientsArray } from "./session";

export default class CreateSessionUtil {
    async create(req: RequestEx, clientsArray: Array<any>, session: any) {
      try {
        let dataConfig: Sessions = this.getClient(session);
        if (dataConfig.status != null && dataConfig.status !== 'CLOSED') return;
        dataConfig.status = 'INITIALIZING';
  
        const myTokenStore = new FileTokenStore(dataConfig.client as ClientWhatsApp).tokenStore;
  
        await myTokenStore.getToken(session);
  
        if (config.customUserDataDir) {
            config.createOptions.puppeteerOptions = {
            userDataDir: config.customUserDataDir + session,
          };
        }
  
        const wppClient = await create(
                Object.assign({}, { tokenStore: myTokenStore }, config.createOptions, {
                session: session,
                deviceName: config.deviceName,
                poweredBy: config.poweredBy || 'WPPConnect-Server',
                
                catchQR: (base64Qr: string, _asciiQR: string, _attempt: string, urlCode: string) => {
                  this.exportQR(req, base64Qr, urlCode, dataConfig);
                },
                onLoadingScreen: (percent: string, message: string) => {
                  req.logger.info(`[${session}] ${percent}% - ${message}`);
                },
                statusFind: (statusFind: string) => {
                  try {
                    if (statusFind === 'autocloseCalled' || statusFind === 'desconnectedMobile') {
                      dataConfig.status = 'CLOSED';
                      dataConfig.qrcode = null;
                      dataConfig.client?.close();
                      //clientsArray[session] = undefined;
                    }
                    //callWebHook(client, req, 'status-find', { status: statusFind });
                    req.logger.info(statusFind + '\n\n');
                  } catch (error) {}
                },
              }) as unknown as CreateOptions
        );

        for(const ses of clientsArray) {
          if(ses.session == session) {
            ses.client = wppClient;
          }
        }
        await this.start(req, dataConfig);
  
        if (config.webhook.participants_changed_group) {
          await this.onParticipantsChanged(req, dataConfig.client as Whatsapp);
        }
  
        if (config.webhook.reactions) {
          await this.onReactionMessage(dataConfig.client as Whatsapp, req);
        }
      } catch (e) {
        req.logger.error(e);
      }
    }
  
    async opendata(req: RequestEx, session: string) {
      await this.create(req, clientsArray, session);
    }
  
    exportQR(_req: RequestEx, qrCode: string, urlCode: string, client: Sessions) {
      //eventEmitter.emit(`qrcode-${client.session}`, qrCode, urlCode, client);]
      client.qrcode = qrCode;
      client.status = 'QRCODE';
      client.urlcode = urlCode;
      qrCode = qrCode.replace('data:image/png;base64,', '');
      //const imageBuffer = Buffer.from(qrCode, 'base64');

      return { status: 'qrcode', qrcode: qrCode, urlcode: urlCode };
    }
  
    async onParticipantsChanged(_req: RequestEx, client: Whatsapp) {
      await client.isConnected();
      await client.onParticipantsChanged((_ParticipantEvent: ParticipantEvent) => {
        // Logica aqui
      });
    }
  
    async start(req: RequestEx, client: Sessions) {
      try {
        await client.client?.isConnected();
        client.status = "CONNECTED";
        client.qrcode = null;
  
        req.logger.info(`Started Session: ${client.session}`);
        //callWebHook(client, req, 'session-logged', { status: 'CONNECTED'});
        //req.io.emit('session-logged', { status: true, session: client.session });
      } catch (error) {
        req.logger.error(error);
        //req.io.emit('session-error', client.session);
      }
  
      await this.checkStateSession(client.client as Whatsapp, req);
      await this.listenMessages(client.client as Whatsapp, req);
  
      if (config.webhook.acks) {
        await this.listenAcks(client.client as Whatsapp, req);
      }
  
      if (config.webhook.presence) {
        await this.onPresenceChanged(client.client as Whatsapp, req);
      }
    }
  
    async checkStateSession(client: Whatsapp, req: RequestEx) {
      client.onStateChange((state) => {
        req.logger.info(`State Change ${state}: ${client.session}`);
        const conflits = [SocketState.CONFLICT];
  
        if (conflits.includes(state)) {
          client.useHere();
        }
      });
    }
  
    async listenMessages(client: Whatsapp, _req: RequestEx) {
      client.onMessage(async (message: Message) => {
        
        if (message.type === 'location')
          client.onLiveLocation(message.sender.id._serialized, (_location: LiveLocation) => {
            //callWebHook(client, req, 'location', location);
          });
      });
  
      client.onAnyMessage((message: Message) => {
        console.log(message);
      });
  
      client.onIncomingCall(async (_call: any) => {
        //req.io.emit('incomingcall', call);
      });
    }
  
    async listenAcks(client: Whatsapp, _req: RequestEx) {
      client.onAck(async (_ack: Ack) => {
        //req.io.emit('onack', ack);
      });
    }
  
    async onPresenceChanged(client: Whatsapp, _req: RequestEx) {
      client.onPresenceChanged(async (_presenceChangedEvent: PresenceEvent) => {
        //req.io.emit('onpresencechanged', presenceChangedEvent);
      });
    }
  
    async onReactionMessage(client: Whatsapp, _req: RequestEx) {
      await client.isConnected();
      client.onReactionMessage(async (_reaction: any) => {
        //req.io.emit('onreactionmessage', reaction);
      });
    }
  
    getClient(session: any): ClientWhatsApp {
      let client = null;
      for(const cli of clientsArray) {
        if(cli.session === session) {
          client = cli;
        }
      }
  
      if (!client) {
        clientsArray.push({ status: undefined, session: session })
        for(const cli of clientsArray) {
          if(cli.session === session) {
            client = cli;
          }
        }
      }
      return client as ClientWhatsApp;
    }
  }