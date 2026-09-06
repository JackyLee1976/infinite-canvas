/**
 * OneWork 工作区数据隔离 · 纯函数层（工作区数据隔离专项 P0，基准 202609062300）。
 *
 * 设计（方案 A · 记录打标，而非存储 key 切分）：
 * - 项目/素材记录加可选 `owWorkspaceId` 标记；存储层全量保留所有工作区的记录
 *   （多工作区共存，切工作区只切换可见上下文，绝不删除旧工作区数据）。
 * - `workspaceId == null`（画布独立打开于浏览器 / 消息未同步）→ 全部可见（现状行为）。
 * - 记录未打标（存量数据）→ 视为 legacy，在归属打标完成前对所有工作区可见（兜底降级，
 *   宁可多见不可错删；首次收到工作区消息时统一打标，之后进入严格隔离）。
 * - blob 存储（image_files/media_files）的清理以内存全量 projects/assets 为可达性依据，
 *   本方案不物理切换内存集合，因此其他工作区引用的 blob 天然不会被误删。
 */

export type OwWorkspaceTagged = {
    /** OneWork 工作区隔离键；存量数据无此字段（legacy）。 */
    owWorkspaceId?: string;
};

/** 记录在指定工作区下是否可见。纯函数。 */
export function isRecordVisibleInWorkspace(
    record: OwWorkspaceTagged | null | undefined,
    workspaceId: string | null | undefined,
): boolean {
    if (!workspaceId) return true;
    if (!record) return false;
    return !record.owWorkspaceId || record.owWorkspaceId === workspaceId;
}

/** 按工作区过滤记录集合。workspaceId 为空时原样返回（同一引用，避免无谓重渲染）。 */
export function filterRecordsByWorkspace<T extends OwWorkspaceTagged>(
    records: T[] | undefined,
    workspaceId: string | null | undefined,
): T[] {
    if (!workspaceId) return records ?? [];
    return (records ?? []).filter((record) => isRecordVisibleInWorkspace(record, workspaceId));
}

/**
 * 给存量未打标记录统一归属打标。返回 null 表示无需变更（引用不变，调用方跳过 setState）。
 * 已打标记录保持原样（不覆盖，多工作区共存）。
 */
export function tagUntaggedRecords<T extends OwWorkspaceTagged>(
    records: T[] | undefined,
    workspaceId: string | null | undefined,
): T[] | null {
    if (!workspaceId || !records || !records.length) return null;
    let changed = false;
    const next = records.map((record) => {
        if (record.owWorkspaceId) return record;
        changed = true;
        return { ...record, owWorkspaceId: workspaceId };
    });
    return changed ? next : null;
}
