import React from 'react';
import {
  TouchableOpacity as RNTouchableOpacity,
  TouchableOpacityProps,
} from 'react-native';

export function TouchableOpacity(props: TouchableOpacityProps) {
  return <RNTouchableOpacity activeOpacity={0.78} {...props} />;
}

export default TouchableOpacity;