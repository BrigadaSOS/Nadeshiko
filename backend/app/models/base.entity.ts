import { BaseEntity as TypeOrmBaseEntity, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { FindManyOptions, FindOptionsWhere } from 'typeorm';
import { NotFoundError } from '@app/errors';

type ExistsEntity = {
  existsBy(where: unknown): Promise<boolean>;
  name: string;
};

export abstract class BaseEntity extends TypeOrmBaseEntity {
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt?: Date;

  static paginate<TThis extends typeof BaseEntity>(
    this: TThis & {
      find(options: FindManyOptions<InstanceType<TThis>>): Promise<InstanceType<TThis>[]>;
      name: string;
    },
    params: {
      find: Omit<FindManyOptions<InstanceType<TThis>>, 'take' | 'skip'>;
      exists?: {
        entity: ExistsEntity;
        where: unknown;
      };
      take: number;
      skip: number;
    },
  ) {
    return (async () => {
      const rows = await this.find({
        ...params.find,
        take: params.take + 1,
        skip: params.skip,
      });

      const hasMore = rows.length > params.take;
      const items = hasMore ? rows.slice(0, params.take) : rows;

      if (items.length === 0 && params.exists) {
        const entityExists = await params.exists.entity.existsBy(params.exists.where);
        if (!entityExists) {
          throw new NotFoundError(`${params.exists.entity.name} not found`);
        }
      }

      return {
        items,
        pagination: {
          hasMore,
          cursor: hasMore ? params.skip + items.length : null,
        },
      };
    })();
  }

  static async softDeleteOrFail<TThis extends typeof BaseEntity>(
    this: TThis & {
      createQueryBuilder(alias?: string): {
        softDelete(): {
          where(criteria: unknown): { execute(): Promise<{ affected?: number | null }> };
        };
      };
      name: string;
    },
    where: FindOptionsWhere<InstanceType<TThis>> | FindOptionsWhere<InstanceType<TThis>>[],
    detail?: string,
  ): Promise<void> {
    const result = await this.createQueryBuilder().softDelete().where(where).execute();

    if (!result.affected) {
      throw new NotFoundError(detail ?? `${this.name} not found`);
    }
  }

  static async deleteOrFail<TThis extends typeof BaseEntity>(
    this: TThis & {
      createQueryBuilder(alias?: string): {
        delete(): {
          where(criteria: unknown): { execute(): Promise<{ affected?: number | null }> };
        };
      };
      name: string;
    },
    where: FindOptionsWhere<InstanceType<TThis>> | FindOptionsWhere<InstanceType<TThis>>[],
    detail?: string,
  ): Promise<void> {
    const result = await this.createQueryBuilder().delete().where(where).execute();

    if (!result.affected) {
      throw new NotFoundError(detail ?? `${this.name} not found`);
    }
  }

  static async updateOrFail<TThis extends typeof BaseEntity, TPatch extends object>(
    this: TThis & {
      findOne(options: {
        where: FindOptionsWhere<InstanceType<TThis>> | FindOptionsWhere<InstanceType<TThis>>[];
      }): Promise<InstanceType<TThis> | null>;
      name: string;
    },
    params: {
      where: FindOptionsWhere<InstanceType<TThis>> | FindOptionsWhere<InstanceType<TThis>>[];
      patch: TPatch;
      detail?: string;
    },
  ): Promise<InstanceType<TThis>> {
    const entity = await this.findOne({ where: params.where });

    if (!entity) {
      throw new NotFoundError(params.detail ?? `${this.name} not found`);
    }

    Object.assign(entity, params.patch as object);
    await entity.save();
    return entity;
  }
}
