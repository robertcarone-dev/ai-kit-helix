Shader "Hidden/Helix/GeometryDebug"
{
    SubShader
    {
        Pass
        {
            Cull Back ZWrite On ZTest LEqual
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "UnityCG.cginc"
            float4x4 _HelixWorldToView;
            float4x4 _HelixProjection;
            float4 _HelixMaterialColor;
            int _HelixView;
            float2 _HelixDepthRange;
            struct Attributes { float4 position : POSITION; float3 normal : NORMAL; float4 tangent : TANGENT; float2 uv : TEXCOORD0; };
            struct Varyings { float4 position : SV_POSITION; float3 normal : TEXCOORD0; float4 tangent : TEXCOORD1; float2 uv : TEXCOORD2; float depth : TEXCOORD3; };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.position = mul(_HelixProjection, mul(_HelixWorldToView, mul(unity_ObjectToWorld, input.position)));
                output.normal = mul((float3x3)_HelixWorldToView, UnityObjectToWorldNormal(input.normal));
                output.tangent = float4(mul((float3x3)_HelixWorldToView, mul((float3x3)unity_ObjectToWorld, input.tangent.xyz)), input.tangent.w);
                output.uv = input.uv;
                output.depth = -mul(_HelixWorldToView, mul(unity_ObjectToWorld, input.position)).z;
                return output;
            }
            float4 Frag(Varyings input) : SV_Target
            {
                if (_HelixView == 7) return _HelixMaterialColor;
                if (_HelixView == 1) return float4(normalize(input.normal) * 0.5 + 0.5, 1);
                if (_HelixView == 2) return float4(frac(input.uv), 0, 1);
                if (_HelixView == 3) return float4(normalize(input.tangent.xyz) * 0.5 + 0.5, 1);
                if (_HelixView == 4) return float4((input.tangent.www * 0.5 + 0.5), 1);
                if (_HelixView == 5) return float4(saturate((input.depth - _HelixDepthRange.x) / (_HelixDepthRange.y - _HelixDepthRange.x)).xxx, 1);
                if (_HelixView == 6) return float4((frac((floor(input.uv.x * 10) + floor(input.uv.y * 10)) * 0.5) * 2).xxx, 1);
                return float4(1, 1, 1, 1);
            }
            ENDHLSL
        }
    }
}
