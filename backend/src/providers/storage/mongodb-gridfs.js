const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const mongoose = require('mongoose');

const createMongoGridFsAdapter = (db) => {
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'privateParcelProofs' });
  return {
    async put({ ownerId, file, contentType, metadata }) {
      const upload = bucket.openUploadStream(`private-${new mongoose.Types.ObjectId().toString()}`, {
        contentType,
        metadata: { ...metadata, ownerId }
      });
      try {
        await pipeline(Readable.from([file]), upload);
        return { key: String(upload.id) };
      } catch (error) {
        if (upload.id) await bucket.delete(upload.id).catch(() => {});
        throw error;
      }
    },
    openPrivate({ key }) {
      return bucket.openDownloadStream(new mongoose.Types.ObjectId(key));
    },
    removePrivate(key) {
      return bucket.delete(new mongoose.Types.ObjectId(key));
    }
  };
};

module.exports = { createMongoGridFsAdapter };
