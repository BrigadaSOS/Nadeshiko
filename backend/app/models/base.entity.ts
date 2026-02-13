import { BaseEntity as TypeOrmBaseEntity, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export abstract class BaseEntity extends TypeOrmBaseEntity {
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt?: Date;
}
