import {
    Table,
    Model,
    Column,
    DataType,
    ForeignKey,
    BelongsTo,
    CreatedAt,
    UpdatedAt,
  } from "sequelize-typescript";
  import { User } from "../user/user"; 
  import { Segment } from "../media/segment";
  
  export enum ReportStatus {
    REPORTED = 0,
    UNDER_REVIEW = 1,
    RESOLVED = 2,
    DISMISSED = 3,
  }
  
  export enum ReportType {
    WRONG_AUDIO = 0,
    DELAYED_AUDIO = 1,
    NO_IMAGE_OR_AUDIO = 2,
    NSFW_SEGMENT = 3,
    BAD_QUALITY_SEGMENT = 4
  }

  @Table({
    timestamps: true,  
    tableName: "Report",
  })
  export class Report extends Model {
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    })
    id!: number;
  
    @ForeignKey(() => Segment)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    segment_id!: number;
  
    @Column({
      type: DataType.STRING,
      allowNull: true,
      unique: true,
    })
    segment_uuid!: string;
  
    @Column({
      type: DataType.STRING,
      allowNull: false,
    })
    report_type!: string;
  
    @ForeignKey(() => User)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    user_id!: number;
  
    @Column({
      type: DataType.TEXT,
      allowNull: true,
    })
    user_comment!: string;
  
    @ForeignKey(() => User)
    @Column({
      type: DataType.INTEGER,
      allowNull: true,
    })
    corrected_by!: number;
  
    @Column({
      type: DataType.DATE,
      allowNull: true,
    })
    report_fix_timestamp!: Date;
  
    @Column({
      type: DataType.SMALLINT,
      allowNull: false,
      defaultValue: ReportStatus.REPORTED
    })
    status!: number;
  
    @Column({
      type: DataType.STRING,
      allowNull: true,
    })
    tags!: string;
  
    @BelongsTo(() => Segment)
    segment!: Segment;
  
    @BelongsTo(() => User, "user_id")
    user!: User;
  
    @BelongsTo(() => User, "revised_by")
    corrector!: User;
  }
  