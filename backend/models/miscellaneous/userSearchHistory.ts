import { Table, Model, Column, DataType } from "sequelize-typescript";
import { DataTypes } from "sequelize";

export enum EventTypeHistory {
  SEARCH_MAIN_QUERY_TEXT = 600,
  SEARCH_MULTI_QUERY_TEXT = 601,
}

@Table({
  timestamps: false,
  tableName: "UserSearchHistory",
})
export class UserSearchHistory extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  })
  created_at!: Date;

  @Column({
    type: DataType.SMALLINT,
    allowNull: false,
    defaultValue: EventTypeHistory.SEARCH_MAIN_QUERY_TEXT,
  })
  event_type!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: false,
  })
  query!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    unique: false,
  })
  ip_address!: string;

  @Column({
    type: DataType.BIGINT,
    allowNull: true,
    unique: false,
  })
  hits!: number;
}
