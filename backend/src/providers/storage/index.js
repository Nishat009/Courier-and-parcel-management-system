const unavailable = () => Object.assign(new Error('Private proof storage is not configured'), { code: 'STORAGE_NOT_CONFIGURED', status: 503 });

const createPrivateStorageProvider = ({ adapter } = {}) => ({
  configured: Boolean(adapter),
  async put({ ownerId, file, contentType, metadata }) {
    if (!adapter) throw unavailable();
    const object = await adapter.put({ ownerId: String(ownerId), file, contentType, metadata, visibility: 'private' });
    if (!object?.key) throw new Error('Storage adapter did not return a private object key');
    return { key: object.key };
  },
  async open({ key, actor }) {
    if (!adapter) throw unavailable();
    return adapter.openPrivate({ key, actor });
  },
  async remove({ key }) {
    if (!adapter) throw unavailable();
    return adapter.removePrivate(key);
  }
});

module.exports = { createPrivateStorageProvider };
