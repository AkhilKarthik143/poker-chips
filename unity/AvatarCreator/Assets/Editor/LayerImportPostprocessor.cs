using UnityEditor;
using UnityEngine;

public sealed class LayerImportPostprocessor : AssetPostprocessor
{
    private void OnPreprocessTexture()
    {
        if (!assetPath.Contains("/Resources/AvatarLayers/")) return;
        TextureImporter texture = (TextureImporter)assetImporter;
        texture.textureType = TextureImporterType.Sprite;
        texture.spriteImportMode = SpriteImportMode.Single;
        texture.spritePixelsPerUnit = 256;
        texture.mipmapEnabled = false;
        texture.filterMode = FilterMode.Bilinear;
        texture.textureCompression = TextureImporterCompression.Uncompressed;
        texture.alphaSource = TextureImporterAlphaSource.FromInput;
        texture.alphaIsTransparency = false;
    }
}

