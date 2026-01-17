import { Table, Model, Column, DataType, ForeignKey } from 'sequelize-typescript';
import type { Sequelize } from 'sequelize-typescript';
import { User } from './user';

@Table({
  timestamps: false,
  tableName: 'UserAuth',
})
export class UserAuth extends Model {
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
  provider!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  providerUserId!: string;

  declare user?: User;

  static associate(sequelize: Sequelize) {
    const UserModel = sequelize.models.User;

    UserAuth.belongsTo(UserModel, { foreignKey: 'userId', as: 'user' });
  }
}
