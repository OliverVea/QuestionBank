/**
 * Hash-based route parsing/building. The URL after `#` encodes the active tab and,
 * within Manage, the drill-down position so a refresh restores where you were.
 *
 * Shapes:
 *   #/learn
 *   #/practice
 *   #/manage
 *   #/manage/book/<bookId>
 *   #/manage/book/<bookId>/chapter/<chapterId>
 */

export type TabId = 'learn' | 'practice' | 'manage';

/** The Manage drill-down position, by id (objects are re-hydrated from these). */
export interface ManageLocation {
  bookId?: string;
  chapterId?: string;
}

export interface Route {
  tab: TabId;
  manage: ManageLocation;
}

const TAB_IDS: readonly TabId[] = ['learn', 'practice', 'manage'];

function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

/** Parse the current `location.hash` into a route. Defaults to the Manage tab. */
export function parseHash(hash: string): Route {
  // Strip a leading '#', then a leading '/', then split.
  const path = hash.replace(/^#/, '').replace(/^\//, '');
  const segments = path.split('/').filter((s) => s !== '');

  const [tabSeg, ...rest] = segments;
  const tab: TabId = tabSeg !== undefined && isTabId(tabSeg) ? tabSeg : 'manage';

  if (tab !== 'manage') return { tab, manage: {} };

  // rest looks like: ['book', <bookId>, 'chapter', <chapterId>]
  const manage: ManageLocation = {};
  if (rest[0] === 'book' && rest[1] !== undefined) {
    manage.bookId = rest[1];
    if (rest[2] === 'chapter' && rest[3] !== undefined) {
      manage.chapterId = rest[3];
    }
  }
  return { tab, manage };
}

/** Build the hash string (including leading '#') for a route. */
export function buildHash(route: Route): string {
  if (route.tab !== 'manage') return `#/${route.tab}`;

  let path = '#/manage';
  const { bookId, chapterId } = route.manage;
  if (bookId !== undefined) {
    path += `/book/${bookId}`;
    if (chapterId !== undefined) path += `/chapter/${chapterId}`;
  }
  return path;
}
