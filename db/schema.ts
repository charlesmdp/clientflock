import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const searches = sqliteTable('searches', {
 id: text('id').primaryKey(), cacheKey:text('cache_key').notNull().unique(), input:text('input').notNull(),
 stage:integer('stage').notNull().default(0), status:text('status').notNull().default('working'),
 data:text('data').notNull().default('{}'), responseId:text('response_id'), lease:text('lease'),
 leaseUntil:integer('lease_until').notNull().default(0), attempts:integer('attempts').notNull().default(0),
 createdAt:integer('created_at').notNull(), updatedAt:integer('updated_at').notNull(), expiresAt:integer('expires_at').notNull(), error:text('error')
});
export const budgets=sqliteTable('budgets',{key:text('key').primaryKey(),count:integer('count').notNull().default(0)});
