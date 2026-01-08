import { Table, Model, Column, DataType, CreatedAt } from 'sequelize-typescript';

export enum SyncOperation {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

export enum SyncStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Table({
  timestamps: true,
  tableName: 'es_sync_log',
  updatedAt: false,
})
export class EsSyncLog extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  table_name!: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  record_id!: number;

  @Column({
    type: DataType.ENUM(...Object.values(SyncOperation)),
    allowNull: false,
  })
  operation!: SyncOperation;

  @Column({
    type: DataType.ENUM(...Object.values(SyncStatus)),
    allowNull: false,
    defaultValue: SyncStatus.PENDING,
  })
  status!: SyncStatus;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  error_message!: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  retry_count!: number;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  last_retry_at!: Date | null;

  @CreatedAt
  created_at!: Date;
}
