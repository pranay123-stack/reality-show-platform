import nodeConfig from '@reality/config/eslint/node';

export default [...nodeConfig, { ignores: ['dist/**', 'src/generated/**'] }];
