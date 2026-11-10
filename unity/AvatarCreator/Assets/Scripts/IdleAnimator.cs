using UnityEngine;

public sealed class IdleAnimator : MonoBehaviour
{
    public LayerCompositor Compositor;
    public bool ReducedMotion;
    private Vector3 start;

    private void Start() { start = transform.localPosition; }

    private void Update()
    {
        if (Compositor == null) return;
        if (ReducedMotion)
        {
            transform.localPosition = start;
            Compositor.Eyes.transform.localScale = Vector3.one;
            Compositor.Hat.transform.localPosition = Vector3.zero;
            return;
        }
        float time = Time.unscaledTime;
        transform.localPosition = start + Vector3.up * (Mathf.Sin(time * 1.7f) * 0.008f);
        float blink = Mathf.Repeat(time, 4.7f) < 0.13f ? 0.12f : 1f;
        Compositor.Eyes.transform.localScale = new Vector3(1f, blink, 1f);
        Compositor.Hat.transform.localPosition = Vector3.up * (Mathf.Sin(time * 1.7f + 0.4f) * 0.004f);
    }
}
