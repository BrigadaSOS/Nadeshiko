import { Entity, PrimaryColumn, Column, OneToMany, BaseEntity } from 'typeorm';

@Entity('Role')
export class Role extends BaseEntity {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  description?: string;

  @OneToMany('UserRole', 'role')
  userRoles!: any[];
}
