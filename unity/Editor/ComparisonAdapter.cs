using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Helix.Comparison
{
    // Project implementations must survive reconstruction after a domain reload.
    public abstract class ComparisonAdapter
    {
        public abstract JObject Preflight(ComparisonContext context);
        public abstract JObject SaveState(ComparisonContext context);
        public abstract void Prepare(ComparisonContext context);
        public abstract bool IsReady(ComparisonContext context);
        public abstract void SelectView(ComparisonContext context, string name);
        public abstract ComparisonFrame Capture(ComparisonContext context);
        public abstract void Restore(ComparisonContext context);
        public abstract bool VerifyRestored(ComparisonContext context);
    }

    public class ComparisonContext
    {
        public string Scenario { get; set; }
        public string Output { get; set; }
        public string ProjectRoot { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public JObject ProjectState { get; set; }
    }

    public class ComparisonFrame
    {
        // Owned by the adapter. The helper does not destroy or resize it.
        public Texture2D Image { get; set; }
        public JObject Ui { get; set; }
        public string Source { get; set; }
    }
}
