import { BaseEntity as TypeOrmBaseEntity, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { FindOptionsWhere, SelectQueryBuilder } from 'typeorm';
import { NotFoundError } from '@app/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@lib/cursor';

type ConcreteEntity = (new () => BaseEntity) & typeof BaseEntity;

type ExistsEntity = {
  existsBy(where: unknown): Promise<boolean>;
  name: string;
};

export abstract class BaseEntity extends TypeOrmBaseEntity {
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt?: Date;

  static paginateWithKeyset<TThis extends ConcreteEntity>(
    this: TThis,
    params: {
      take: number;
      cursor?: string | null;
      orderBy?: { column: string; direction: 'ASC' | 'DESC' };
      query: () => SelectQueryBuilder<InstanceType<TThis>>;
      count: true;
      exists?: { entity: ExistsEntity; where: unknown };
    },
  ): Promise<{ items: InstanceType<TThis>[]; pagination: { hasMore: boolean; cursor: string | null }; totalCount: number }>;

  static paginateWithKeyset<TThis extends ConcreteEntity>(
    this: TThis,
    params: {
      take: number;
      cursor?: string | null;
      orderBy?: { column: string; direction: 'ASC' | 'DESC' };
      query: () => SelectQueryBuilder<InstanceType<TThis>>;
      count?: false;
      exists?: { entity: ExistsEntity; where: unknown };
    },
  ): Promise<{ items: InstanceType<TThis>[]; pagination: { hasMore: boolean; cursor: string | null } }>;

  static async paginateWithKeyset<TThis extends ConcreteEntity>(
    this: TThis,
    params: {
      take: number;
      cursor?: string | null;
      orderBy?: { column: string; direction: 'ASC' | 'DESC' };
      query: () => SelectQueryBuilder<InstanceType<TThis>>;
      count?: boolean;
      exists?: { entity: ExistsEntity; where: unknown };
    },
  ) {
    const orderBy = params.orderBy ?? { column: 'id', direction: 'DESC' as const };
    const qb = params.query();

    const countPromise = params.count ? qb.clone().getCount() : undefined;

    const decodedCursor = decodeKeysetCursor<number>(params.cursor);
    if (decodedCursor !== undefined) {
      const op = orderBy.direction === 'DESC' ? '<' : '>';
      qb.andWhere(`${qb.alias}.${orderBy.column} ${op} :cursor`, { cursor: decodedCursor });
    }

    qb.orderBy(`${qb.alias}.${orderBy.column}`, orderBy.direction);
    qb.take(params.take + 1);

    const [rows, totalCount] = await Promise.all([qb.getMany(), countPromise]);

    const hasMore = rows.length > params.take;
    const items = hasMore ? rows.slice(0, params.take) : rows;

    if (items.length === 0 && params.exists) {
      const entityExists = await params.exists.entity.existsBy(params.exists.where);
      if (!entityExists) {
        throw new NotFoundError(`${params.exists.entity.name} not found`);
      }
    }

    const nextCursor =
      hasMore && items.length > 0
        ? encodeKeysetCursor((items[items.length - 1] as Record<string, unknown>)[orderBy.column])
        : null;

    return {
      items,
      pagination: {
        hasMore,
        cursor: nextCursor,
      },
      ...(totalCount !== undefined ? { totalCount } : {}),
    };
  }

  static async softDeleteOrFail<TThis extends ConcreteEntity>(
    this: TThis,
    params: {
      where: FindOptionsWhere<InstanceType<TThis>> | FindOptionsWhere<InstanceType<TThis>>[];
      detail?: string;
    },
  ): Promise<void> {
    const result = await this.createQueryBuilder().softDelete().where(params.where).execute();

    if (!result.affected) {
      throw new NotFoundError(params.detail ?? `${this.name} not found`);
    }
  }

  static async deleteOrFail<TThis extends ConcreteEntity>(
    this: TThis,
    params: {
      where: FindOptionsWhere<InstanceType<TThis>> | FindOptionsWhere<InstanceType<TThis>>[];
      detail?: string;
    },
  ): Promise<void> {
    const result = await this.createQueryBuilder().delete().where(params.where).execute();

    if (!result.affected) {
      throw new NotFoundError(params.detail ?? `${this.name} not found`);
    }
  }

  static async updateOrFail<TThis extends ConcreteEntity>(
    this: TThis,
    params: {
      where: FindOptionsWhere<InstanceType<TThis>> | FindOptionsWhere<InstanceType<TThis>>[];
      patch: object;
      detail?: string;
    },
  ): Promise<void> {
    const result = await this.update(params.where as FindOptionsWhere<BaseEntity>, params.patch);

    if (!result.affected) {
      throw new NotFoundError(params.detail ?? `${this.name} not found`);
    }
  }

  static async findAndUpdateOrFail<TThis extends ConcreteEntity>(
    this: TThis,
    params: {
      where: FindOptionsWhere<InstanceType<TThis>> | FindOptionsWhere<InstanceType<TThis>>[];
      patch: object;
      detail?: string;
    },
  ): Promise<InstanceType<TThis>> {
    const entity = (await this.findOne({
      where: params.where as FindOptionsWhere<BaseEntity>,
    })) as InstanceType<TThis> | null;

    if (!entity) {
      throw new NotFoundError(params.detail ?? `${this.name} not found`);
    }

    Object.assign(entity, params.patch);
    await entity.save();
    return entity;
  }
}
