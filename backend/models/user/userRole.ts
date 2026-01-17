import { Table, Model, Column, DataType, ForeignKey } from 'sequelize-typescript';
import type { Sequelize } from 'sequelize-typescript';
import { User } from './user';
import { Role } from './role';

@Table({
  timestamps: false,
  tableName: 'UserRole',
})
export class UserRole extends Model {
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
  })
  id_user!: number;

  declare user?: User;

  @ForeignKey(() => Role)
  @Column({
    type: DataType.INTEGER,
  })
  id_role!: number;

  declare role?: Role;

  static associate(sequelize: Sequelize) {
    const UserModel = sequelize.models.User;
    const RoleModel = sequelize.models.Role;

    UserRole.belongsTo(UserModel, { foreignKey: 'id_user', as: 'user' });
    UserRole.belongsTo(RoleModel, { foreignKey: 'id_role', as: 'role' });
  }
}
