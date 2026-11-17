package __PACKAGE_NAME__

import android.view.Window
import android.view.WindowManager
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.interfaces.ExtraWindowEventListener
import java.util.Collections
import java.util.WeakHashMap

/** Keep both the activity and React Native Modal geometry unchanged when the IME opens. */
internal object WarehouseKeyboardPolicy : ReactInstanceEventListener, ExtraWindowEventListener {
  // ReactHost keeps its instance listeners in a list, so make installation idempotent.
  // Weak keys and the stateless listener retain no activity, window or old ReactContext.
  private val installedHosts = Collections.newSetFromMap(WeakHashMap<ReactHost, Boolean>())

  @Synchronized
  fun install(host: ReactHost) {
    if (installedHosts.add(host)) {
      host.addReactInstanceEventListener(this)
    }
    // The host may already be initialized (for example after a lifecycle reload).
    host.currentReactContext?.let(::onReactContextInitialized)
  }

  override fun onReactContextInitialized(context: ReactContext) {
    // ReactContext's listener set deduplicates this singleton. Each new context
    // receives it after reload without retaining any previous context here.
    context.addExtraWindowEventListener(this)
  }

  fun applyTo(window: Window) {
    val previousMode = window.attributes.softInputMode
    val nextMode =
      (previousMode and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST.inv()) or
        WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
    if (previousMode != nextMode) {
      window.setSoftInputMode(nextMode)
    }
  }

  override fun onExtraWindowCreate(window: Window) {
    // RN Modal explicitly sets ADJUST_RESIZE before emitting this public event.
    applyTo(window)
  }

  override fun onExtraWindowDestroy(window: Window) = Unit
}
