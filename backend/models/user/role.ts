import { Table, Model, Column, DataType } from 'sequelize-typescript';
import type { Sequelize } from 'sequelize-typescript';
import type { UserRole } from './userRole';

export const DEFAULT_QUOTA_LIMIT = 2500;

@Table({
  timestamps: false,
  tableName: 'Role',
})
export class Role extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
  })
  declare id: number;

  @Column({
    type: DataType.STRING,
  })
  name!: string;

  @Column({
    type: DataType.STRING,
  })
  description!: string;

  @Column({
    type: DataType.INTEGER,
    defaultValue: DEFAULT_QUOTA_LIMIT,
  })
  quotaLimit!: number;

  declare userRoles?: UserRole[];

  static associate(sequelize: Sequelize) {
    const UserRole = sequelize.models.UserRole;

    Role.hasMany(UserRole, { foreignKey: 'id_role', as: 'userRoles' });
  }
}
