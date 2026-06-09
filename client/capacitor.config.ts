import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.monroe.moneyweather',
  appName: 'Money Weather',
  webDir: 'dist',
  plugins: {
    SQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      androidDatabaseLocation: 'files/databases',
    },
  },
}

export default config
