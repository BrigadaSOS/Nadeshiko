import {
  Table,
  Model,
  Column,
  DataType,
  ForeignKey,
  BeforeCreate,
  BelongsTo,
} from "sequelize-typescript";
import { v3 as uuidv3 } from "uuid";
import { Media } from "./media";

export enum SegmentStatus {
  DELETED=0,
  ACTIVE=1,
  SUSPENDED=2,
  VERIFIED=3,
  INVALID_SENTENCE=100,
  SENTENCE_TOO_LONG=101
}

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
    type: DataType.STRING,
    allowNull: true,
    unique: true,
  })
  uuid!: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  position!: number;

  @Column({
    type: DataType.SMALLINT,
    allowNull: false,
    defaultValue: SegmentStatus.ACTIVE
  })
  status!: number;

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
    type: DataType.STRING(400),
    allowNull: true,
  })
  content!: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  content_length!: number;

  @Column({
    type: DataType.STRING(400),
    allowNull: true,
  })
  content_spanish!: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: true,
  })
  content_spanish_mt!: boolean;

  @Column({
    type: DataType.STRING(400),
    allowNull: true,
  })
  content_english!: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: true,
  })
  content_english_mt!: boolean;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false
  })
  is_nsfw!: boolean;

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

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  actor_ja!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  actor_es!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  actor_en!: string;

  @Column({
    type: DataType.SMALLINT,
    allowNull: false
  })
  episode!: number;

  @Column({
    type: DataType.SMALLINT,
    allowNull: false
  })
  season!: number;

  @ForeignKey(() => Media)
  @Column({
    type: DataType.INTEGER,
    allowNull: false
  })
  media_id!: number;
  
  @BelongsTo(() => Media)
  media!: Media;

  @BeforeCreate
  static async generateLength(instance: Segment) {
    if (instance.content) {
      instance.content_length = instance.content.length;
    }
  }

  @BeforeCreate
  static async generateUUID(instance: Segment) {
    // Generate UUIDv3 based on the romaji_name, season, episode and the position of segment
    const uuidNamespace: string | undefined =
      process.env.UUID_NAMESPACE?.toString();
    const unique_base_id = `${instance.media_id}-${instance.season}-${instance.episode}-${instance.position}`;
    instance.uuid = uuidv3(unique_base_id, uuidNamespace!);
  }
}