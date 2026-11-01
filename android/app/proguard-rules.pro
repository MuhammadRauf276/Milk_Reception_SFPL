# ProGuard Rules for SFPL Milk Reception MOT
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class com.shakarganj.milkreception.mot.bridge.** { *; }
-keep class com.shakarganj.milkreception.mot.gps.** { *; }
-keep class com.shakarganj.milkreception.mot.offline.** { *; }

-dontwarn okhttp3.**
-dontwarn okio.**
