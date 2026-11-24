type Real = typeof import("../../../components/ThreadNotificationCoordinator");

export const startThreadNotifications: Real["startThreadNotifications"] = (...args) => {
  const stop = import("../../../components/ThreadNotificationCoordinator").then((m) =>
    m.startThreadNotifications(...args),
  );
  return () => void stop.then((dispose) => dispose());
};
