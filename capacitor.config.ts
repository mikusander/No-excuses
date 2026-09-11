import type { CapacitorConfig } from '@capacitor/cli';

const isDev = process.env.BUILD_DEV === 'true' || process.env.CAPACITOR_DEV === 'true';

const config: CapacitorConfig = {
  appId: isDev ? 'com.noexcuses.workout.dev' : 'com.noexcuses.workout',
  appName: isDev ? 'No Excuses Dev' : 'No Excuses',
  webDir: 'dist',
  server: isDev
    ? {
        url: 'http://10.10.111.194:5173',
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
