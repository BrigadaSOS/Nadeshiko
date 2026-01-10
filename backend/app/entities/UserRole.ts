import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';

@Entity('UserRole')
export class UserRole {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'role_id', type: 'int' })
  roleId!: number;

  @ManyToOne('User', 'userRoles')
  @JoinColumn({ name: 'user_id' })
  user!: any;

  @ManyToOne('Role', 'userRoles')
  @JoinColumn({ name: 'role_id' })
  role!: any;
}
