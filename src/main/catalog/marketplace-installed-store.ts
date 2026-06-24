import Store, { type Options as StoreOptions } from 'electron-store';
import type { MarketplaceInstalledRecord } from '../../shared/catalog-types';

class MarketplaceInstalledStore {
  private store: Store<{ records: MarketplaceInstalledRecord[] }>;

  constructor() {
    const storeOptions: StoreOptions<{ records: MarketplaceInstalledRecord[] }> & {
      projectName?: string;
    } = {
      name: 'marketplace-installed',
      projectName: 'open-cowork',
      defaults: {
        records: [],
      },
    };
    this.store = new Store<{ records: MarketplaceInstalledRecord[] }>(storeOptions);
  }

  list(): MarketplaceInstalledRecord[] {
    return this.store.get('records', []);
  }

  get(catalogId: string): MarketplaceInstalledRecord | undefined {
    return this.list().find((record) => record.catalogId === catalogId);
  }

  save(record: MarketplaceInstalledRecord): void {
    const records = this.list().filter((item) => item.catalogId !== record.catalogId);
    records.push(record);
    this.store.set('records', records);
  }

  remove(catalogId: string): void {
    this.store.set(
      'records',
      this.list().filter((record) => record.catalogId !== catalogId)
    );
  }
}

export const marketplaceInstalledStore = new MarketplaceInstalledStore();
