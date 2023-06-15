import { Table, Model, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import { Season } from "./season";
import { Segment } from "./segment";

@Table({
  timestamps: false,
  tableName: "Episode",
})
export class Episode extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true
  })
  id!: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  number!: number;

  @ForeignKey(() => Season)
  @Column({
    type: DataType.INTEGER,
    allowNull: false
  })
  seasonId!: number;

  @BelongsTo(() => Season)
  season!: Season;

  @HasMany(() => Segment)
  segment!: Segment[];
}