/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 陶橘 —— 品牌主色,课表主角色(比原亮橙低一档饱和,大面积铺色不刺眼)
        tangerine: {
          50: '#FFF4ED',
          100: '#FFE6D6',
          200: '#F8CDAF',
          300: '#F0AF85',
          400: '#EA8C58',
          500: '#E5763A',
          600: '#CC5F26',
          700: '#A94C1B',
        },
        // 奶黄 —— 背景与提示
        butter: {
          50: '#FFFCF0',
          100: '#FEF7D4',
          200: '#FBEBA4',
          300: '#F8DF7C',
          400: '#F4CE4E',
          500: '#E8B733',
          600: '#C79320',
        },
        // 蓝紫 —— 次级区块
        periwi: {
          50: '#F2F5FE',
          100: '#E2E8FB',
          200: '#C4D0F5',
          300: '#A0B2ED',
          400: '#7B92DC',
          500: '#6479C9',
          600: '#4E5FA8',
          700: '#3D4A83',
        },
        // 苔绿 —— 完成/成功
        grass: {
          50: '#EFF7F0',
          100: '#DAEDE0',
          200: '#B8DCC2',
          300: '#8FCB9D',
          400: '#71BC81',
          500: '#4FA35E',
          600: '#41894E',
          700: '#376F42',
        },
        // 雾蓝 —— 课表色块
        sky: {
          300: '#A9D2E3',
          400: '#7FB6CE',
          500: '#469EC4',
          600: '#3681A4',
        },
        // 松青 —— 课表色块
        teal: {
          300: '#96C8BC',
          400: '#6BAA9B',
          500: '#3FA08A',
          600: '#2F8070',
        },
        // 陶土红 / 可可棕 —— 课表色块与强调
        cherry: {
          300: '#E3B0A6',
          400: '#CE8172',
          500: '#BC5F4E',
          600: '#9E4A3B',
        },
        cocoa: {
          300: '#CBA98D',
          400: '#B98F6C',
          500: '#A97C5B',
          600: '#8A6244',
        },
        // 暖黑
        ink: {
          DEFAULT: '#241F1A',
          soft: '#5B5249',
          mute: '#9A8F84',
        },
      },
      fontFamily: {
        sans: ['Inter', '"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        display: ['Inter', '"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        // 柔和分层阴影:一档近、一档远,去掉硬边贴纸感
        soft: '0 1px 2px rgba(36,31,26,.04), 0 6px 16px -10px rgba(36,31,26,.14)',
        'soft-lg': '0 2px 4px rgba(36,31,26,.04), 0 18px 40px -20px rgba(36,31,26,.20)',
        'soft-sm': '0 1px 2px rgba(36,31,26,.05)',
        // 兼容旧类名(仍在用的地方),但改成柔和的
        sticker: '0 1px 2px rgba(36,31,26,.04), 0 6px 16px -10px rgba(36,31,26,.14)',
        'sticker-sm': '0 1px 2px rgba(36,31,26,.04)',
        'sticker-lg': '0 2px 4px rgba(36,31,26,.04), 0 18px 40px -20px rgba(36,31,26,.20)',
        pop: '0 18px 44px -18px rgba(36,31,26,.28)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        'slide-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        pop: { '0%': { transform: 'scale(.96)' }, '100%': { transform: 'scale(1)' } },
        wiggle: {
          '0%,100%': { transform: 'rotate(-4deg)' },
          '50%': { transform: 'rotate(4deg)' },
        },
        twinkle: {
          '0%,100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '.55', transform: 'scale(.86)' },
        },
        // 桌宠:上下浮动 / 眨眼 / 摆尾 / 打呼噜的小 z
        'pet-float': {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-7px)' },
        },
        'pet-blink': {
          '0%,92%,100%': { transform: 'scaleY(1)' },
          '96%': { transform: 'scaleY(.08)' },
        },
        'pet-tail': {
          '0%,100%': { transform: 'rotate(-7deg)' },
          '50%': { transform: 'rotate(11deg)' },
        },
        'pet-z': {
          '0%': { opacity: '0', transform: 'translate(0,0) scale(.8)' },
          '40%': { opacity: '.85' },
          '100%': { opacity: '0', transform: 'translate(14px,-26px) scale(1.15)' },
        },
      },
      animation: {
        'slide-up': 'slide-up .22s ease-out',
        'fade-in': 'fade-in .18s ease-out',
        pop: 'pop .2s cubic-bezier(.34,1.56,.64,1)',
        wiggle: 'wiggle .5s ease-in-out',
        twinkle: 'twinkle 2.4s ease-in-out infinite',
        'pet-float': 'pet-float 3.4s ease-in-out infinite',
        'pet-blink': 'pet-blink 5.2s ease-in-out infinite',
        'pet-tail': 'pet-tail 2.4s ease-in-out infinite',
        'pet-z': 'pet-z 3.6s ease-out infinite',
      },
    },
  },
  plugins: [],
}
