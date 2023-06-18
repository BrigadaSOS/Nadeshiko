import {
  Table,
  Model,
  Column,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
} from "sequelize-typescript";
import { Episode } from "./episode";

@Table({
  timestamps: false,
  tableName: "Segment",
})
export class Segment extends Model {
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
  position!: number;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  start_time!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  end_time!: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  content!: Text;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  content_spanish!: Text;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  content_english!: Text;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  path_image!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  path_audio!: string;

  @ForeignKey(() => Episode)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  episodeId!: number;

  @BelongsTo(() => Episode)
  episode!: Episode;
  
  
}
