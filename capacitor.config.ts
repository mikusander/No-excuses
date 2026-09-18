import type { CapacitorConfig } from '@capacitor/cli';

const isDev = process.env.BUILD_DEV === 'true' || process.env.CAPACITOR_DEV === 'true';

const config: CapacitorConfig = {
  appId: isDev ? 'com.noexcuses.workout.dev' : 'com.noexcuses.workout',
  appName: isDev ? 'No Excuses Dev' : 'No Excuses',
  webDir: 'dist',
  server: isDev
    ? {
        url: process.env.CAPACITOR_DEV_SERVER_URL || 'http://172.20.10.2:5173',
        cleartext: true,
      }
    : undefined,
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#3b82f6',
      sound: 'beep.wav',
    },
  },
};

export default config;
