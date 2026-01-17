import { Table, Model, Column, DataType, ForeignKey } from 'sequelize-typescript';
import { DataTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { User } from './user';

@Table({
  timestamps: true,
  tableName: 'UserToken',
})
export class UserToken extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  token!: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  })
  created_at!: Date;

  @Column({
    type: DataType.ENUM,
    values: ['PASSWORD_RESET', 'ACCOUNT_VERIFICATION'],
    allowNull: false,
  })
  type!: string;

  declare user?: User;

  static associate(sequelize: Sequelize) {
    const UserModel = sequelize.models.User;

    UserToken.belongsTo(UserModel, { foreignKey: 'userId', as: 'user' });
  }
}
