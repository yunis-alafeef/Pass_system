import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export type SeatEventType = 'held' | 'released' | 'booked' | 'available';

export interface SeatUpdatePayload {
  tripId: string;
  seatNumber: number;
  type: SeatEventType;
  userId?: string;
  expiresAt?: string;
  timestamp: string;
}

/**
 * بوابة WebSocket للتحديثات اللحظية لحالة المقاعد (Task 3.10).
 * كل غرفة = رحلة (trip room).
 */
@WebSocketGateway({
  namespace: '/seats',
  cors: { origin: '*' },
})
export class SeatsGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SeatsGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    this.logger.debug(`عميل متصل: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`عميل مفصول: ${client.id}`);
  }

  /** الانضمام لغرفة رحلة لمتابعة تحديثات مقاعدها */
  @SubscribeMessage('joinTrip')
  handleJoinTrip(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tripId: string },
  ): { joined: string } {
    if (data?.tripId) {
      void client.join(`trip:${data.tripId}`);
    }
    return { joined: data?.tripId };
  }

  @SubscribeMessage('leaveTrip')
  handleLeaveTrip(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tripId: string },
  ): { left: string } {
    if (data?.tripId) {
      void client.leave(`trip:${data.tripId}`);
    }
    return { left: data?.tripId };
  }

  /** بثّ تحديث مقعد لجميع متابعي الرحلة */
  broadcastSeatUpdate(payload: SeatUpdatePayload): void {
    this.server
      .to(`trip:${payload.tripId}`)
      .emit('seatUpdated', payload);
  }

  /** بثّ تحديث عدة مقاعد دفعة واحدة */
  broadcastSeatBatch(
    tripId: string,
    seats: Array<{ seatNumber: number; type: SeatEventType }>,
  ): void {
    this.server.to(`trip:${tripId}`).emit('seatsBatchUpdated', {
      tripId,
      seats: seats.map((s) => ({
        ...s,
        timestamp: new Date().toISOString(),
      })),
    });
  }
}
