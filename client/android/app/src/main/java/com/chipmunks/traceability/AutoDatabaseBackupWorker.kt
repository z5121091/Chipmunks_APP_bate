package com.chipmunks.traceability

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.util.Base64
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.File
import java.io.FileInputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONObject

object AutoDatabaseBackupScheduler {
  private const val UNIQUE_WORK_NAME = "auto_database_backup"
  private const val PERIODIC_WORK_NAME = "auto_database_backup_periodic"
  private const val PERIODIC_BACKUP_INTERVAL_MINUTES = 6L * 60L
  private const val MIN_CHANGED_BACKUP_INTERVAL_MINUTES = 6L * 60L
  private const val REQUEST_CODE = 5121091
  private const val PREFS_NAME = "auto_database_backup"
  private const val LAST_SUCCESS_DATE_KEY = "last_success_date"
  private const val LAST_SUCCESS_AT_MS_KEY = "last_success_at_ms"
  private const val LAST_SUCCESS_DATABASE_MODIFIED_KEY = "last_success_database_modified"
  private const val LAST_SUCCESS_DATABASE_SIZE_KEY = "last_success_database_size"
  private const val LAST_SUCCESS_DATABASE_SIGNATURE_KEY = "last_success_database_signature"
  private const val FORCE_NEXT_BACKUP_KEY = "force_next_backup"
  private const val LAST_NO_DATA_DATE_KEY = "last_no_data_date"
  const val ACTION_RUN_BACKUP = "com.chipmunks.traceability.AUTO_DATABASE_BACKUP"
  private val BEIJING_TIME_ZONE: TimeZone = TimeZone.getTimeZone("Asia/Shanghai")

  fun schedule(context: Context) {
    scheduleDailyAlarm(context)
    enqueuePeriodicBackup(context)
    if (shouldForceNextBackup(context)) {
      enqueueBackup(context)
      return
    }

    val today = todayBeijing()
    if (getLastSuccessDate(context) != today) {
      enqueueBackup(context)
      return
    }

    val databaseFile = getDatabaseFile(context)
    if (
      databaseFile.exists() &&
      hasDatabaseChangedSinceLastSuccess(context, databaseFile) &&
      hasChangedBackupIntervalElapsed(context)
    ) {
      enqueueBackup(context)
    }
  }

  fun enqueueBackup(context: Context) {
    val request = OneTimeWorkRequestBuilder<AutoDatabaseBackupWorker>()
      .setConstraints(backupConstraints())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
      .build()

    WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
      UNIQUE_WORK_NAME,
      ExistingWorkPolicy.REPLACE,
      request
    )
  }

  private fun enqueuePeriodicBackup(context: Context) {
    val request = PeriodicWorkRequestBuilder<AutoDatabaseBackupWorker>(
      PERIODIC_BACKUP_INTERVAL_MINUTES,
      TimeUnit.MINUTES
    )
      .setConstraints(backupConstraints())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
      .build()

    WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
      PERIODIC_WORK_NAME,
      ExistingPeriodicWorkPolicy.UPDATE,
      request
    )
  }

  private fun backupConstraints(): Constraints {
    return Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .build()
  }

  fun getLastSuccessDate(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(LAST_SUCCESS_DATE_KEY, null)
  }

  fun markSuccess(
    context: Context,
    date: String,
    databaseFile: File,
    sourceSignature: String?
  ) {
    val editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(LAST_SUCCESS_DATE_KEY, date)
      .putLong(LAST_SUCCESS_AT_MS_KEY, System.currentTimeMillis())
      .remove(FORCE_NEXT_BACKUP_KEY)

    if (sourceSignature == null) {
      editor
        .putLong(LAST_SUCCESS_DATABASE_MODIFIED_KEY, -1L)
        .putLong(LAST_SUCCESS_DATABASE_SIZE_KEY, -1L)
        .remove(LAST_SUCCESS_DATABASE_SIGNATURE_KEY)
    } else {
      editor
        .putLong(LAST_SUCCESS_DATABASE_MODIFIED_KEY, databaseFile.lastModified())
        .putLong(LAST_SUCCESS_DATABASE_SIZE_KEY, databaseFile.length())
        .putString(LAST_SUCCESS_DATABASE_SIGNATURE_KEY, sourceSignature)
    }

    editor.commit()
  }

  fun requestBackup(context: Context, force: Boolean = false) {
    if (force) {
      markForceNextBackup(context)
    }
    enqueueBackup(context)
  }

  fun requestBackupOnNextSchedule(context: Context) {
    markForceNextBackup(context)
  }

  fun shouldForceNextBackup(context: Context): Boolean {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(FORCE_NEXT_BACKUP_KEY, false)
  }

  private fun markForceNextBackup(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(FORCE_NEXT_BACKUP_KEY, true)
      .commit()
  }

  fun getDatabaseFile(context: Context): File {
    return File(context.filesDir, "SQLite/palm_warehouse_v2.db")
  }

  fun hasSuccessfulBackupForCurrentDatabase(
    context: Context,
    date: String,
    databaseFile: File
  ): Boolean {
    return getLastSuccessDate(context) == date &&
      !hasDatabaseChangedSinceLastSuccess(context, databaseFile)
  }

  private fun hasDatabaseChangedSinceLastSuccess(context: Context, databaseFile: File): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val lastSignature = prefs.getString(LAST_SUCCESS_DATABASE_SIGNATURE_KEY, null)
    if (lastSignature != null) {
      return getDatabaseSignature(databaseFile) != lastSignature
    }

    val lastModified = prefs.getLong(LAST_SUCCESS_DATABASE_MODIFIED_KEY, -1L)
    val lastSize = prefs.getLong(LAST_SUCCESS_DATABASE_SIZE_KEY, -1L)
    if (lastModified < 0L || lastSize < 0L) {
      return true
    }

    return databaseFile.lastModified() != lastModified || databaseFile.length() != lastSize
  }

  fun hasChangedBackupIntervalElapsed(context: Context): Boolean {
    val lastSuccessAt = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getLong(LAST_SUCCESS_AT_MS_KEY, -1L)

    if (lastSuccessAt < 0L) {
      return true
    }

    return System.currentTimeMillis() - lastSuccessAt >=
      TimeUnit.MINUTES.toMillis(MIN_CHANGED_BACKUP_INTERVAL_MINUTES)
  }

  fun getDatabaseSignature(databaseFile: File): String {
    return listOf(
      databaseFile,
      File("${databaseFile.absolutePath}-wal")
    ).joinToString("|") { file ->
      if (file.exists()) {
        "${file.name}:${file.lastModified()}:${file.length()}"
      } else {
        "${file.name}:missing"
      }
    }
  }

  fun getLastNoDataDate(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(LAST_NO_DATA_DATE_KEY, null)
  }

  fun markNoData(context: Context, date: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(LAST_NO_DATA_DATE_KEY, date)
      .remove(FORCE_NEXT_BACKUP_KEY)
      .commit()
  }

  fun writeStatus(
    context: Context,
    status: String,
    trigger: String,
    reason: String? = null,
    fileName: String? = null,
    errorMessage: String? = null
  ) {
    try {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val payload = JSONObject()
        .put("source", "native-workmanager")
        .put("checkedAtMs", System.currentTimeMillis())
        .put("status", status)
        .put("trigger", trigger)

      reason?.let { payload.put("reason", it) }
      fileName?.let { payload.put("fileName", it) }
      errorMessage?.let { payload.put("errorMessage", it) }

      val lastSuccessAt = prefs.getLong(LAST_SUCCESS_AT_MS_KEY, -1L)
      if (lastSuccessAt > 0L) {
        payload.put("lastSuccessAtMs", lastSuccessAt)
      }
      prefs.getString(LAST_SUCCESS_DATE_KEY, null)?.let {
        payload.put("lastSuccessDate", it)
      }

      val statusDir = File(context.filesDir, "auto-db-backup").apply {
        mkdirs()
      }
      File(statusDir, "native-status.json").writeText(
        payload.toString(),
        StandardCharsets.UTF_8
      )
    } catch (error: Exception) {
      Log.w("AutoDbBackup", "Failed to write native backup status", error)
    }
  }

  private fun scheduleDailyAlarm(context: Context) {
    val pendingIntent = PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      Intent(context, AutoDatabaseBackupReceiver::class.java).setAction(ACTION_RUN_BACKUP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarmManager.setInexactRepeating(
      AlarmManager.RTC_WAKEUP,
      nextBeijingMidnightMillis(),
      TimeUnit.DAYS.toMillis(1),
      pendingIntent
    )
  }

  private fun nextBeijingMidnightMillis(): Long {
    return Calendar.getInstance(BEIJING_TIME_ZONE).apply {
      add(Calendar.DAY_OF_MONTH, 1)
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }.timeInMillis
  }

  fun todayBeijing(): String {
    return SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
      timeZone = BEIJING_TIME_ZONE
    }.format(Calendar.getInstance(BEIJING_TIME_ZONE).time)
  }
}

class AutoDatabaseBackupReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      AutoDatabaseBackupScheduler.ACTION_RUN_BACKUP,
      Intent.ACTION_BOOT_COMPLETED -> AutoDatabaseBackupScheduler.schedule(context)
      Intent.ACTION_SHUTDOWN,
      "android.intent.action.REBOOT",
      "android.intent.action.QUICKBOOT_POWEROFF" -> {
        Log.i("AutoDbBackup", "Device shutdown/reboot detected, force backup on next schedule")
        AutoDatabaseBackupScheduler.requestBackupOnNextSchedule(context)
      }
    }
  }
}

class AutoDatabaseBackupWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): Result {
    return try {
      val today = AutoDatabaseBackupScheduler.todayBeijing()
      Log.i(TAG, "Auto database backup worker started for $today")
      AutoDatabaseBackupScheduler.writeStatus(applicationContext, "running", "workmanager")

      val databaseFile = AutoDatabaseBackupScheduler.getDatabaseFile(applicationContext)
      if (!databaseFile.exists() || databaseFile.length() <= 0L) {
        Log.w(TAG, "SQLite database file does not exist, skip auto backup: ${databaseFile.absolutePath}")
        AutoDatabaseBackupScheduler.markNoData(applicationContext, today)
        AutoDatabaseBackupScheduler.writeStatus(
          applicationContext,
          "skipped",
          "workmanager",
          "database-missing"
        )
        return Result.success()
      }
      Log.i(TAG, "SQLite database file found: ${databaseFile.absolutePath}, size=${databaseFile.length()}")

      val forceBackup = AutoDatabaseBackupScheduler.shouldForceNextBackup(applicationContext)
      if (
        !forceBackup &&
        AutoDatabaseBackupScheduler.hasSuccessfulBackupForCurrentDatabase(
          applicationContext,
          today,
          databaseFile
        )
      ) {
        Log.i(TAG, "Auto database backup already completed for current database today, skip")
        AutoDatabaseBackupScheduler.writeStatus(
          applicationContext,
          "skipped",
          "workmanager",
          "already-current"
        )
        return Result.success()
      }

      if (
        !forceBackup &&
        AutoDatabaseBackupScheduler.getLastSuccessDate(applicationContext) == today &&
        !AutoDatabaseBackupScheduler.hasChangedBackupIntervalElapsed(applicationContext)
      ) {
        Log.i(TAG, "Auto database backup changed too recently, skip until interval elapses")
        AutoDatabaseBackupScheduler.writeStatus(
          applicationContext,
          "skipped",
          "workmanager",
          "interval-not-elapsed"
        )
        return Result.success()
      }

      if (!hasBusinessData(databaseFile)) {
        Log.w(TAG, "SQLite database has no business data, skip auto backup to avoid overwriting a valid remote file")
        AutoDatabaseBackupScheduler.markNoData(applicationContext, today)
        AutoDatabaseBackupScheduler.writeStatus(
          applicationContext,
          "skipped",
          "workmanager",
          "no-business-data"
        )
        return Result.success()
      }

      val backupSnapshot = uploadBackup(databaseFile, today)
      AutoDatabaseBackupScheduler.markSuccess(
        applicationContext,
        today,
        databaseFile,
        backupSnapshot.sourceSignature
      )
      AutoDatabaseBackupScheduler.writeStatus(
        applicationContext,
        "success",
        "workmanager",
        fileName = backupSnapshot.file.name
      )
      Log.i(TAG, "Auto database backup completed: ${backupSnapshot.file.name}")
      Result.success()
    } catch (error: Exception) {
      Log.w(TAG, "Auto database backup failed", error)
      AutoDatabaseBackupScheduler.writeStatus(
        applicationContext,
        "failed",
        "workmanager",
        errorMessage = error.message ?: "Unknown error"
      )
      Result.retry()
    }
  }

  private fun hasBusinessData(databaseFile: File): Boolean {
    val businessTables = listOf(
      "orders",
      "materials",
      "inbound_records",
      "inventory_check_records",
      "unpack_records"
    )

    SQLiteDatabase.openDatabase(databaseFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
      .use { database ->
        return businessTables.any { tableName ->
          tableExists(database, tableName) && tableHasRows(database, tableName)
        }
      }
  }

  private fun tableExists(database: SQLiteDatabase, tableName: String): Boolean {
    database.rawQuery(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      arrayOf(tableName)
    ).use { cursor ->
      return cursor.moveToFirst()
    }
  }

  private fun tableHasRows(database: SQLiteDatabase, tableName: String): Boolean {
    database.rawQuery("SELECT 1 FROM $tableName LIMIT 1", null).use { cursor ->
      return cursor.moveToFirst()
    }
  }

  private data class DatabaseBackupSnapshot(
    val file: File,
    val sourceSignature: String?
  )

  private fun createDatabaseSnapshot(
    databaseFile: File,
    backupFileName: String
  ): DatabaseBackupSnapshot {
    val backupDir = File(applicationContext.cacheDir, "auto-db-backup").apply {
      mkdirs()
    }
    val backupFile = File(backupDir, backupFileName)
    if (backupFile.exists() && !backupFile.delete()) {
      throw IllegalStateException("Unable to replace stale database snapshot: ${backupFile.absolutePath}")
    }

    val signatureBefore = AutoDatabaseBackupScheduler.getDatabaseSignature(databaseFile)
    val escapedPath = backupFile.absolutePath.replace("'", "''")
    SQLiteDatabase.openDatabase(databaseFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
      .use { database ->
        database.execSQL("VACUUM INTO '$escapedPath'")
      }

    if (!backupFile.exists() || backupFile.length() <= 0L) {
      throw IllegalStateException("SQLite did not create a valid database snapshot")
    }

    val signatureAfter = AutoDatabaseBackupScheduler.getDatabaseSignature(databaseFile)
    return DatabaseBackupSnapshot(
      file = backupFile,
      sourceSignature = signatureBefore.takeIf { it == signatureAfter }
    )
  }

  private fun uploadBackup(databaseFile: File, date: String): DatabaseBackupSnapshot {
    val server = WebDavServer.from(DEFAULT_UPDATE_SERVER)
    val backupDirectoryUrl = "${server.cleanBaseUrl}/backup/"

    for (sequence in 1..999) {
      val backupFileName = buildBackupFileName(date, sequence)
      val backupFileUrl = "$backupDirectoryUrl${urlEncode(backupFileName)}"
      if (remoteFileExists(server, backupFileUrl)) {
        continue
      }

      val backupSnapshot = createDatabaseSnapshot(databaseFile, backupFileName)
      val backupFile = backupSnapshot.file
      Log.i(TAG, "Database snapshot created: ${backupFile.absolutePath}, size=${backupFile.length()}")
      Log.i(TAG, "Uploading database backup to: $backupFileUrl")
      if (putFile(server, backupFileUrl, backupFile)) {
        return backupSnapshot
      }
    }

    throw IllegalStateException("NAS 当日数据库备份序号已超过 999：$date")
  }

  private fun remoteFileExists(server: WebDavServer, targetUrl: String): Boolean {
    val connection = openConnection(server, targetUrl, "HEAD")
    try {
      val responseCode = connection.responseCode
      return when {
        responseCode in 200..299 -> true
        responseCode == HttpURLConnection.HTTP_NOT_FOUND -> false
        responseCode == HttpURLConnection.HTTP_FORBIDDEN ||
          responseCode == HttpURLConnection.HTTP_BAD_METHOD ||
          responseCode == HttpURLConnection.HTTP_NOT_IMPLEMENTED -> {
          Log.w(TAG, "WebDAV HEAD unsupported for existence check: $responseCode, rely on PUT precondition")
          false
        }
        else -> throw IllegalStateException(
          "NAS 备份文件检查失败：HTTP $responseCode ${connection.responseMessage}"
        )
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun putFile(server: WebDavServer, targetUrl: String, file: File): Boolean {
    val connection = openConnection(server, targetUrl, "PUT")
    connection.setRequestProperty("Content-Type", "application/octet-stream")
    connection.setRequestProperty("If-None-Match", "*")
    connection.setFixedLengthStreamingMode(file.length())
    connection.doOutput = true

    try {
      FileInputStream(file).use { input ->
        connection.outputStream.use { output: OutputStream ->
          input.copyTo(output)
        }
      }

      val responseCode = connection.responseCode
      if (responseCode == HttpURLConnection.HTTP_PRECON_FAILED) {
        Log.w(TAG, "WebDAV target already exists, try next file name: $responseCode")
        return false
      }
      if (responseCode == HttpURLConnection.HTTP_CONFLICT) {
        throw IllegalStateException(
          "NAS 备份目录不存在或无写入权限：HTTP $responseCode ${connection.responseMessage}"
        )
      }
      if (responseCode !in 200..299) {
        throw IllegalStateException(
          "NAS 数据库备份上传失败：HTTP $responseCode ${connection.responseMessage}"
        )
      }
      Log.i(TAG, "WebDAV PUT completed: $responseCode")
      return true
    } finally {
      connection.disconnect()
    }
  }

  private fun openConnection(server: WebDavServer, targetUrl: String, method: String): HttpURLConnection {
    val connection = URL(targetUrl).openConnection() as HttpURLConnection
    connection.requestMethod = method
    connection.connectTimeout = 15_000
    connection.readTimeout = 60_000
    connection.setRequestProperty("Accept", "*/*")
    server.authorizationHeader?.let {
      connection.setRequestProperty("Authorization", it)
    }
    return connection
  }

  private fun safeFileName(value: String): String {
    val sanitized = value.replace(Regex("""[\\/:*?"<>|\p{Cntrl}]"""), "_").trim('_', ' ')
    return sanitized.ifBlank { "warehouse" }
  }

  private fun buildBackupFileName(date: String, sequence: Int): String {
    val appName = safeFileName(applicationContext.getString(R.string.app_name))
    return "${appName}_${date}_${sequence.toString().padStart(2, '0')}.db"
  }

  private fun urlEncode(value: String): String {
    return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
  }

  private data class WebDavServer(
    val cleanBaseUrl: String,
    val authorizationHeader: String?
  ) {
    companion object {
      fun from(rawUrl: String): WebDavServer {
        val uri = URI(rawUrl.trim().trimEnd('/'))
        val userInfo = uri.rawUserInfo
        val cleanUri = URI(
          uri.scheme,
          null,
          uri.host,
          uri.port,
          uri.path,
          uri.query,
          uri.fragment
        )

        val authHeader = userInfo?.let {
          val decodedUserInfo = URLDecoder.decode(it, StandardCharsets.UTF_8.name())
          val token = Base64.encodeToString(decodedUserInfo.toByteArray(StandardCharsets.UTF_8), Base64.NO_WRAP)
          "Basic $token"
        }

        return WebDavServer(cleanUri.toString().trimEnd('/'), authHeader)
      }
    }
  }

  companion object {
    private const val TAG = "AutoDbBackup"
    private const val DEFAULT_UPDATE_SERVER = "https://zx5121091:zx5121091Z..@dav.zx5121091.fnos.net:443/AppUpdate"
  }
}
