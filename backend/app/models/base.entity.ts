import { BaseEntity as TypeOrmBaseEntity, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { FindManyOptions, FindOptionsWhere, SelectQueryBuilder } from 'typeorm';
import type { t_OpaqueCursorPagination } from 'generated/models';
import { NotFoundError } from '@app/errors';
import { decodeKeysetCursor, decodeOffsetCursor, encodeKeysetCursor, encodeOffsetCursor } from '@lib/cursor';

type ConcreteEntity = (new () => BaseEntity) & typeof BaseEntity;

type ExistsEntity = {
  existsBy(where: unknown): Promise<boolean>;
  name: string;
};

type OffsetFindOptions<TThis extends ConcreteEntity> = Omit<FindManyOptions<InstanceType<TThis>>, 'take' | 'skip'>;

type OffsetBaseParams = {
  take: number;
  cursor?: string | null;
  exists?: {
    entity: ExistsEntity;
    where: unknown;
  };
};

type OffsetResult<TThis extends ConcreteEntity> = {
  items: InstanceType<TThis>[];
  pagination: t_OpaqueCursorPagination;
};

export abstract class BaseEntity extends TypeOrmBaseEntity {
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt?: Date;

  static paginateWithOffset<TThis extends ConcreteEntity>(
    this: TThis,
    params: OffsetBaseParams & { findAndCount: OffsetFindOptions<TThis> },
  ): Promise<OffsetResult<TThis> & { totalCount: number }>;

  static paginateWithOffset<TThis extends ConcreteEntity>(
    this: TThis,
    params: OffsetBaseParams & { find?: OffsetFindOptions<TThis> },
  ): Promise<OffsetResult<TThis>>;

  static async paginateWithOffset<TThis extends ConcreteEntity>(
    this: TThis,
    params: OffsetBaseParams & ({ find?: OffsetFindOptions<TThis> } | { findAndCount: OffsetFindOptions<TThis> }),
  ): Promise<OffsetResult<TThis> & { totalCount?: number }> {
    const skip = decodeOffsetCursor(params.cursor);

    let items: InstanceType<TThis>[];
    let hasMore: boolean;
    let totalCount: number | undefined;

    if ('findAndCount' in params && params.findAndCount) {
      const [rows, count] = (await this.findAndCount({
        ...params.findAndCount,
        take: params.take,
        skip,
      } as FindManyOptions)) as [InstanceType<TThis>[], number];
      items = rows;
      totalCount = count;
      hasMore = skip + rows.length < count;
    } else {
      const options = 'find' in params ? params.find : undefined;
      const rows = (await this.find({
        ...options,
        take: params.take + 1,
        skip,
      } as FindManyOptions)) as InstanceType<TThis>[];
      hasMore = rows.length > params.take;
      items = hasMore ? rows.slice(0, params.take) : rows;
    }

    if (items.length === 0 && params.exists) {
      const entityExists = await params.exists.entity.existsBy(params.exists.where);
      if (!entityExists) {
        throw new NotFoundError(`${params.exists.entity.name} not found`);
      }
    }

    return {
      items,
      totalCount,
      pagination: {
        hasMore,
        cursor: hasMore ? encodeOffsetCursor(skip + items.length) : null,
      },
    };
  }

  static async paginateWithKeyset<TThis extends ConcreteEntity>(
    this: TThis,
    params: {
      take: number;
      cursor?: string | null;
      orderBy?: { column: string; direction: 'ASC' | 'DESC' };
      query: () => SelectQueryBuilder<InstanceType<TThis>>;
    },
  ) {
    const orderBy = params.orderBy ?? { column: 'id', direction: 'DESC' as const };
    const qb = params.query();
    const decodedCursor = decodeKeysetCursor<number>(params.cursor);

    if (decodedCursor !== undefined) {
      const op = orderBy.direction === 'DESC' ? '<' : '>';
      qb.andWhere(`${qb.alias}.${orderBy.column} ${op} :cursor`, { cursor: decodedCursor });
    }

    qb.orderBy(`${qb.alias}.${orderBy.column}`, orderBy.direction);
    qb.take(params.take + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > params.take;
    const items = hasMore ? rows.slice(0, params.take) : rows;
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
