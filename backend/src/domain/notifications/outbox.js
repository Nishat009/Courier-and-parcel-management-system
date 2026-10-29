const NotificationOutbox = require('../../models/NotificationOutbox');
const { createEmailProvider } = require('../../providers/email');
const { renderNotification } = require('../../providers/email/notifications');

const MAX_ATTEMPTS = 5;
const LOCK_MS = 2 * 60 * 1000;
const BATCH_SIZE = 10;

const createEmailNotification = async ({ notificationKey, recipient, template, payload, session }) => {
  const [notification] = await NotificationOutbox.create([{
    notificationKey,
    channel: 'email',
    recipient,
    template,
    payload,
    status: 'pending',
    nextAttemptAt: new Date()
  }], session ? { session } : undefined);
  return notification;
};

const claimNext = (now) => NotificationOutbox.findOneAndUpdate({
  attempts: { $lt: MAX_ATTEMPTS },
  $or: [
    { status: 'pending', nextAttemptAt: { $lte: now } },
    { status: 'sending', lockUntil: { $lte: now } }
  ]
}, {
  $set: { status: 'sending', lockUntil: new Date(now.getTime() + LOCK_MS) },
  $inc: { attempts: 1 }
}, { new: true, sort: { createdAt: 1 } });

const retryDelayMs = (attempts) => Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attempts - 1)));

const deliverOne = async (notification, provider) => {
  try {
    const message = renderNotification(notification.template, notification.payload);
    const result = await provider.send({ to: notification.recipient, ...message });
    if (!result.accepted) throw Object.assign(new Error('Email provider did not accept the message'), { code: result.status || 'provider_not_accepted' });
    await NotificationOutbox.updateOne({ _id: notification._id, status: 'sending' }, {
      $set: {
        status: 'accepted', providerStatus: result.status, providerMessageId: result.messageId || '',
        providerAcceptedAt: new Date(), lockUntil: null, lastErrorCode: ''
      }
    });
  } catch (error) {
    const dead = notification.attempts >= MAX_ATTEMPTS;
    await NotificationOutbox.updateOne({ _id: notification._id, status: 'sending' }, {
      $set: {
        status: dead ? 'dead_letter' : 'pending',
        nextAttemptAt: new Date(Date.now() + retryDelayMs(notification.attempts)),
        lockUntil: null,
        lastErrorCode: String(error.code || 'provider_error').slice(0, 80)
      }
    });
    console.error(`Email notification attempt failed (${notification.template}, attempt ${notification.attempts}, ${dead ? 'dead_letter' : 'retry_scheduled'})`);
  }
};

const createNotificationWorker = ({ provider = createEmailProvider(), intervalMs = 5000 } = {}) => {
  let running = false;
  let timer;
  const tick = async () => {
    if (running || !provider.configured) return;
    running = true;
    try {
      for (let index = 0; index < BATCH_SIZE; index += 1) {
        const notification = await claimNext(new Date());
        if (!notification) break;
        await deliverOne(notification, provider);
      }
    } catch (error) {
      console.error('Notification outbox worker failed:', error.message);
    } finally {
      running = false;
    }
  };
  return {
    start() { if (!timer) { timer = setInterval(tick, intervalMs); timer.unref?.(); void tick(); } },
    stop() { if (timer) clearInterval(timer); timer = undefined; }
  };
};

module.exports = { createEmailNotification, createNotificationWorker, MAX_ATTEMPTS };
