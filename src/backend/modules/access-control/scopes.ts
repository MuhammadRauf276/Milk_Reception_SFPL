export type ResourceScope =
  | { kind: 'SYSTEM' }
  | { kind: 'DEPARTMENT'; departmentId: string }
  | { kind: 'SOURCE'; sourceId: string }
  | { kind: 'ROUTE'; routeId: string; sourceId: string }
  | { kind: 'SUPPLIER'; supplierId: string; sourceId?: string }
  | {
      kind: 'RECORD';
      ownerId?: string;
      departmentId?: string;
      sourceId?: string;
      routeId?: string;
      supplierId?: string;
    };

export interface ActorScope {
  systemWide?: boolean;
  departmentIds?: readonly string[];
  sourceIds?: readonly string[];
  routeIds?: readonly string[];
  supplierIds?: readonly string[];
}

function contains(values: readonly string[] | undefined, expected: string): boolean {
  return values?.includes(expected) ?? false;
}

function isNonEmptyRecordScope(scope: Extract<ResourceScope, { kind: 'RECORD' }>): boolean {
  return Boolean(
    scope.ownerId ||
      scope.departmentId ||
      scope.sourceId ||
      scope.routeId ||
      scope.supplierId
  );
}

export function isWithinScope(
  actorId: string,
  actorScope: ActorScope,
  resourceScope: ResourceScope
): boolean {
  if (actorScope.systemWide) return true;

  switch (resourceScope.kind) {
    case 'SYSTEM':
      return false;
    case 'DEPARTMENT':
      return contains(actorScope.departmentIds, resourceScope.departmentId);
    case 'SOURCE':
      return contains(actorScope.sourceIds, resourceScope.sourceId);
    case 'ROUTE':
      return (
        contains(actorScope.sourceIds, resourceScope.sourceId) &&
        (!actorScope.routeIds?.length || contains(actorScope.routeIds, resourceScope.routeId))
      );
    case 'SUPPLIER':
      return (
        contains(actorScope.supplierIds, resourceScope.supplierId) &&
        (!resourceScope.sourceId || contains(actorScope.sourceIds, resourceScope.sourceId))
      );
    case 'RECORD': {
      if (!isNonEmptyRecordScope(resourceScope)) return false;

      return (
        (!resourceScope.ownerId || resourceScope.ownerId === actorId) &&
        (!resourceScope.departmentId || contains(actorScope.departmentIds, resourceScope.departmentId)) &&
        (!resourceScope.sourceId || contains(actorScope.sourceIds, resourceScope.sourceId)) &&
        (!resourceScope.routeId || contains(actorScope.routeIds, resourceScope.routeId)) &&
        (!resourceScope.supplierId || contains(actorScope.supplierIds, resourceScope.supplierId))
      );
    }
  }
}

