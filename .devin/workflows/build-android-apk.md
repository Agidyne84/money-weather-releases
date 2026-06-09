---
description: Build Android APK for Money Weather Capacitor app
---

# Build Android APK

## Prerequisites

1. Install Java JDK 25
   - Download from https://adoptium.net/
   - Typical install path: `C:\Program Files\Eclipse Adoptium\jdk-25`
   - Set `JAVA_HOME` environment variable (see below)

2. Install Android Studio
   - Download from https://developer.android.com/studio
   - During first launch, the setup wizard will prompt for Android SDK installation. Accept the defaults.

3. Set `ANDROID_HOME` environment variable
   - Typical path: `C:\Users\<YourName>\AppData\Local\Android\Sdk`
   - You can verify this path in Android Studio: go to **Settings** > **Languages & Frameworks** > **Android SDK** and look at the "Android SDK Location" field.

## Setting Environment Variables on Windows

Open PowerShell as Administrator and run:

```powershell
# Set JAVA_HOME (adjust path to your JDK installation)
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Eclipse Adoptium\jdk-25", "User")

# Set ANDROID_HOME (adjust if your SDK is in a different location)
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")

# Add platform-tools to User PATH
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$androidPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools"
if ($currentPath -notlike "*$androidPath*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$androidPath", "User")
}

# Verify
$env:JAVA_HOME
$env:ANDROID_HOME
java -version
```

**Restart your terminal/IDE** after setting environment variables for changes to take effect.

Alternatively, set them via Windows Settings:
1. Press `Win + S`, search for **"Edit environment variables for your account"**
2. Under **User variables**, click **New...**
3. Variable name: `JAVA_HOME`, Variable value: your JDK path (e.g. `C:\Program Files\Eclipse Adoptium\jdk-25`)
4. Click **New...** again, Variable name: `ANDROID_HOME`, Variable value: `C:\Users\<YourName>\AppData\Local\Android\Sdk`
5. Select the `Path` variable, click **Edit...**, click **New**, and add: `%ANDROID_HOME%\platform-tools`

## Build Steps

### Step 1: Sync web assets to the Android project

Open a terminal in the project root and run:

```bash
cd client
npx cap sync
```

This copies the built web app and Capacitor plugins into `client/android/`.

### Step 2: Open the project in Android Studio

From the `client` directory, run:

```bash
npx cap open android
```

Or open Android Studio manually and choose **File** > **Open...**, then browse to `client/android` and click **OK**.

Wait for the Gradle sync to finish (you will see a progress bar at the bottom of Android Studio).

### Step 3: Build the debug APK

In Android Studio:

1. Make sure the **Build Variant** is set to **debug**:
   - Open the panel on the left side: click **Build Variants** (if not visible, go to **View** > **Tool Windows** > **Build Variants**).
   - In the table, ensure the **Active Build Variant** for the `:app` module is set to **debug**.

2. Click the top menu **Build**.

3. Hover over **Generate App Bundles or APKs** to open the submenu.

4. Click **Generate APKs**.

5. Wait for the build to complete. You will see a notification in the bottom-right corner saying "Build Analyzer detected..." or "Build completed successfully."

6. Click the notification popup and then click the **locate** or **Show in Explorer** link to open the folder containing `app-debug.apk`.

The debug APK is located at:
```
client/android/app/build/outputs/apk/debug/app-debug.apk
```

### Step 4: Build from command line (alternative)

If you prefer not to use Android Studio's UI, use the Gradle wrapper directly. Make sure `JAVA_HOME` and `ANDROID_HOME` are set first.

```bash
cd client/android
.\gradlew.bat assembleDebug
```

The output will be at:
```
client/android/app/build/outputs/apk/debug/app-debug.apk
```

## Release Build (for distribution)

1. Generate a signing keystore (one-time). Run this in PowerShell or Command Prompt:
   ```bash
   cd client/android/app
   keytool -genkey -v -keystore money-weather-release.keystore -alias moneyweather -keyalg RSA -keysize 2048 -validity 10000
   ```
   You will be prompted to set a password and fill in certificate details. Remember the password.

2. The keystore is now at `client/android/app/money-weather-release.keystore`.

3. Create a file named `keystore.properties` inside `client/android/` (next to `build.gradle`) with this content:
   ```
   storePassword=YOUR_STORE_PASSWORD
   keyPassword=YOUR_KEY_PASSWORD
   keyAlias=moneyweather
   storeFile=money-weather-release.keystore
   ```
   Replace `YOUR_STORE_PASSWORD` and `YOUR_KEY_PASSWORD` with the password you set above.

4. In Android Studio, switch the build variant to **release** (see Step 3 above, but choose **release** in the Build Variants panel).

5. Go to **Build** > **Generate App Bundles or APKs** > **Generate APKs**.

6. Or use the command line:
   ```bash
   cd client/android
   .\gradlew.bat assembleRelease
   ```

7. The signed release APK will be at:
   ```
   client/android/app/build/outputs/apk/release/app-release.apk
   ```
   (If you see `app-release-unsigned.apk` instead, it means the signing config wasn't wired to the release build type. `build.gradle` has been updated to auto-sign when `keystore.properties` is present.)

> **Tip for sideloading:** If you just want to send the app to users without setting up a release keystore, use the **debug APK** instead. Debug builds are automatically signed with a debug certificate and install fine on any Android device. The only downside is that debug builds are slightly larger and include debugging symbols. Just switch the Build Variant back to **debug** and run `Build > Generate App Bundles or APKs > Generate APKs`.

## Install on a Connected Device

### Option A: From Android Studio

1. Connect your Android phone via USB and enable **USB Debugging** in Developer Options.
2. In Android Studio, the device should appear in the toolbar (next to the run button).
3. Click the green **Run** button (triangle) or press `Shift + F10`.

### Option B: From command line

```bash
cd client/android
.\gradlew.bat installDebug
```

### Option C: Manual install via ADB

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```
