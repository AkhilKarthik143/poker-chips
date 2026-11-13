using UnityEngine;

public sealed class IdleAnimator : MonoBehaviour
{
    public LayerCompositor Compositor;
    public bool ReducedMotion;
    private Vector3 restPosition;

    public void SetRestPosition(Vector3 position)
    {
        restPosition = position;
        transform.localPosition = position;
    }

    private void Update()
    {
        if (Compositor == null) return;
        if (ReducedMotion)
        {
            transform.localPosition = restPosition;
            Compositor.Eyes.transform.localScale = Vector3.one;
            Compositor.Brows.transform.localPosition = Vector3.zero;
            Compositor.Mouth.transform.localScale = Vector3.one;
            Compositor.Hat.transform.localPosition = Vector3.zero;
            return;
        }
        float time = Time.unscaledTime;
        transform.localPosition = restPosition + Vector3.up * (Mathf.Sin(time * 1.7f) * 0.008f);
        float phase = Mathf.Repeat(time, 5.6f);
        float blink = phase < 0.12f || (Mathf.FloorToInt(time / 5.6f) % 3 == 2 && phase > 0.28f && phase < 0.38f) ? 0.12f : 1f;
        Compositor.Eyes.transform.localScale = new Vector3(1f, blink, 1f);
        Compositor.Brows.transform.localPosition = Vector3.up * (Mathf.Sin(time * 0.85f) * 0.0025f);
        Compositor.Mouth.transform.localScale = new Vector3(1f + Mathf.Sin(time * 0.85f) * 0.015f, 1f, 1f);
        Compositor.Hat.transform.localPosition = Vector3.up * (Mathf.Sin(time * 1.7f + 0.4f) * 0.004f);
    }
}
