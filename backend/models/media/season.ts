import {
  Table,
  Model,
  Column,
  DataType,
  HasMany,
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import { Media } from "./media";
import { Episode } from "./episode";

@Table({
  timestamps: false,
  tableName: "Season",
})
export class Season extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  number!: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true
  })
  is_visible!: boolean;

  @ForeignKey(() => Media)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  mediaId!: number;

  @BelongsTo(() => Media)
  media!: Media;

  @HasMany(() => Episode)
  episode!: Episode[];
}
