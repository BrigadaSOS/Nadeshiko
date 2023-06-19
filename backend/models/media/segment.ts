import {
  Table,
  Model,
  Column,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
  BeforeCreate,
} from "sequelize-typescript";
import { Season } from "./season";
import { Episode } from "./episode";
import { v3 as uuidv3 } from "uuid";
import { Media } from "./media";

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
  })
  uuid!: string;

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

  @BeforeCreate
  static async generateUUID(instance: Segment) {
    const media = await Media.findOne({
      include: [
        {
          model: Season,
          include: [
            {
              model: Episode,
              where : {
                id: instance.episodeId 
              },
              include: [
                {
                  model: Segment,
                },
              ],
            },
          ],
        },
      ],
    });
    if (media) {
      // Generate UUIDv3 based on the english_name, season, episode and the position of segment
      const uuidNamespace:string | undefined = process.env.UUID_NAMESPACE?.toString();
      const unique_base_id = `${media?.english_name}-${media?.season[0].number}-${media?.season[0].episode[0].number}-${instance.position}`
      instance.uuid = uuidv3(unique_base_id,
        uuidNamespace!
      );
    }
  }
}
