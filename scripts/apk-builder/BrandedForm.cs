using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace Chipmunks.ApkBuilder
{
    // Every application-owned window uses the same multi-size icon as the EXE.
    // Keep it embedded so child windows never depend on the working directory.
    public abstract class BrandedForm : Form
    {
        private Icon ownedIcon;

        protected BrandedForm()
        {
            try
            {
                using (Stream stream = typeof(BrandedForm).Assembly.GetManifestResourceStream("Chipmunks.ApkBuilder.AppIcon.ico"))
                {
                    if (stream != null)
                    {
                        using (Icon source = new Icon(stream)) ownedIcon = (Icon)source.Clone();
                    }
                }
            }
            catch (ArgumentException) { }
            catch (IOException) { }
            // A missing/corrupt custom build resource must not display the
            // unrelated Windows/.NET default icon as the application brand.
            ShowIcon = ownedIcon != null;
            if (ownedIcon != null) Icon = ownedIcon;
        }

        protected override void Dispose(bool disposing)
        {
            try { base.Dispose(disposing); }
            finally
            {
                if (disposing && ownedIcon != null)
                {
                    ownedIcon.Dispose();
                    ownedIcon = null;
                }
            }
        }
    }
}
