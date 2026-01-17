import { Table, Model, Column, DataType } from 'sequelize-typescript';
import type { Sequelize } from 'sequelize-typescript';
import type { Segment } from './segment';

export enum CategoryType {
  ANIME = 1,
  BOOK = 2,
  JDRAMA = 3,
  AUDIOBOOK = 4,
}

@Table({
  timestamps: false,
  tableName: 'Media',
})
export class Media extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  id_anilist!: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  id_tmdb!: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  created_at!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  updated_at!: Date;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  romaji_name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  english_name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  japanese_name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  folder_media_name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  airing_format!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  airing_status!: string;

  @Column({
    type: DataType.ARRAY(DataType.STRING),
    allowNull: true,
  })
  genres!: Array<string>;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  cover!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  banner!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  release_date!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare version: string;

  @Column({
    type: DataType.SMALLINT,
    allowNull: false,
    defaultValue: CategoryType.ANIME,
  })
  category!: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  num_segments!: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  num_seasons!: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  num_episodes!: number;

  declare segments?: Segment[];

  static associate(sequelize: Sequelize) {
    const Segment = sequelize.models.Segment;

    Media.hasMany(Segment, { foreignKey: 'media_id', as: 'segments' });
  }
}
