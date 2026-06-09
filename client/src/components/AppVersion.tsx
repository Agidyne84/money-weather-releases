import React, { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

const AppVersion: React.FC = () => {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    App.getInfo().then((info) => {
      setVersion(info.version)
    }).catch(() => {
      setVersion('')
    })
  }, [])

  if (!version) return null

  return (
    <div className="text-center text-xs text-gray-400 py-2 select-none">
      v{version}
    </div>
  )
}

export default AppVersion
