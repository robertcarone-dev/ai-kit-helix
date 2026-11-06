using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Reflection;
using UnityEditor.Sprites;
using UnityEngine.Experimental.Rendering;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.U2D;
using UnityEngine;
using UnityEngine.U2D;

namespace Helix.Comparison
{
    public static class SpriteUsageCapture
    {
        private static string Hash(string path)
        {
            using (var hash = SHA256.Create())
            using (var stream = File.OpenRead(path)) {
                return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
        }

        // Queries the existing imported atlas state. Never packs, reimports, or modifies project art.
        public static string Inspect(string path, string fileId)
        {
            Sprite selected = null;
            string guid = AssetDatabase.AssetPathToGUID(path);
            foreach (var sprite in AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>()) {
                if (AssetDatabase.TryGetGUIDAndLocalFileIdentifier(sprite, out string assetGuid, out long id)
                    && assetGuid == guid && id.ToString(System.Globalization.CultureInfo.InvariantCulture) == fileId) {
                    selected = sprite;
                }
            }
            if (!selected) {
                throw new ArgumentException("No imported Sprite at the supplied path and local file ID.");
            }
            var atlases = new JArray();
            var boundTexture = SpriteUtility.GetSpriteTexture(selected, true);
            // The preview page list is Editor-version dependent. Compare actual texture objects;
            // same names, compatible variants and equal dimensions do not establish the bound page.
            var previewPages = typeof(SpriteAtlasExtensions).GetMethod("GetPreviewTextures",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic, null, new[] { typeof(SpriteAtlas) }, null);
            foreach (string atlasGuid in AssetDatabase.FindAssets("t:SpriteAtlas", new[] { "Assets" }).OrderBy(value => value)) {
                string atlasPath = AssetDatabase.GUIDToAssetPath(atlasGuid);
                var atlas = AssetDatabase.LoadAssetAtPath<SpriteAtlas>(atlasPath);
                if (!atlas || !atlas.CanBindTo(selected)) {
                    continue;
                }
                var row = new JObject {
                    ["guid"] = atlasGuid,
                    ["path"] = atlasPath,
                    ["sha256"] = Hash(atlasPath),
                    ["metaSha256"] = Hash(atlasPath + ".meta"),
                    ["variant"] = atlas.isVariant,
                    ["tag"] = atlas.tag,
                    ["packedSpriteCount"] = atlas.spriteCount,
                    ["page"] = null
                };
                atlases.Add(row);
                if (previewPages == null || previewPages.ReturnType != typeof(Texture2D[])) {
                    row["reason"] = "preview-page-inventory-unavailable";
                    continue;
                }
                var pages = (Texture2D[])previewPages.Invoke(null, new object[] { atlas });
                int pageIndex = pages != null && boundTexture ? Array.IndexOf(pages, boundTexture) : -1;
                if (pageIndex < 0) {
                    row["reason"] = "bound-texture-not-in-preview-pages";
                    continue;
                }
                var uv = SpriteUtility.GetSpriteUVs(selected, true);
                row["page"] = new JObject {
                    ["index"] = pageIndex,
                    ["name"] = boundTexture.name,
                    ["instanceId"] = boundTexture.GetInstanceID(),
                    ["width"] = boundTexture.width,
                    ["height"] = boundTexture.height,
                    ["graphicsFormat"] = boundTexture.graphicsFormat.ToString(),
                    ["mipLevels"] = boundTexture.mipmapCount,
                    ["filter"] = boundTexture.filterMode.ToString(),
                    ["estimatedMipChainBytes"] = GraphicsFormatUtility.ComputeMipChainSize(boundTexture.width, boundTexture.height, boundTexture.graphicsFormat, boundTexture.mipmapCount),
                    ["uvBounds"] = new JArray(uv.Min(v => v.x), uv.Min(v => v.y), uv.Max(v => v.x), uv.Max(v => v.y))
                };
            }
            var rect = selected.rect;
            return new JObject {
                ["schemaVersion"] = 1,
                ["path"] = path,
                ["guid"] = guid,
                ["fileId"] = fileId,
                ["name"] = selected.name,
                ["assetSha256"] = Hash(path),
                ["metaSha256"] = Hash(path + ".meta"),
                ["buildTarget"] = EditorUserBuildSettings.activeBuildTarget.ToString(),
                ["packingMode"] = EditorSettings.spritePackerMode.ToString(),
                ["sourceRectBottomLeft"] = new JArray(rect.x, rect.y, rect.width, rect.height),
                ["atlases"] = atlases
            }.ToString();
        }
    }
}
