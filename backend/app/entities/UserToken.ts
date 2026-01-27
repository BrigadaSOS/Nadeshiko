import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';

export enum UserTokenType {
  PASSWORD_RESET = 'PASSWORD_RESET',
  ACCOUNT_VERIFICATION = 'ACCOUNT_VERIFICATION',
}

@Entity('UserToken')
export class UserToken {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', unique: true })
  token!: string;

  @Column({
    type: 'enum',
    enum: UserTokenType,
    default: UserTokenType.PASSWORD_RESET,
  })
  type!: UserTokenType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne('User', 'tokens')
  @JoinColumn({ name: 'user_id' })
  user!: any;
}
