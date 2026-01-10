import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

@Entity('UserAuth')
export class UserAuth extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar' })
  provider!: string;

  @Column({ name: 'provider_user_id', type: 'varchar' })
  providerUserId!: string;

  @ManyToOne('User', 'userAuths')
  @JoinColumn({ name: 'user_id' })
  user!: any;
}
