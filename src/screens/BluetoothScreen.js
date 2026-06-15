import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Easing, Alert } from 'react-native';
import { ChevronLeft, Bluetooth, Smartphone, BatteryMedium, CheckCircle2 } from 'lucide-react-native';
import GradientBackground from '../components/GradientBackground';
import { COLORS, SPACING } from '../constants/theme';
import {
    requestBluetoothPermission,
    scanForDevices,
    connectToGivenDevice,
    isBleAvailable,
    writeUserName
} from '../../BLE_connection/TherapyBle';

import AsyncStorage from '@react-native-async-storage/async-storage';
const BluetoothScreen = ({ navigation, route }) => {
    const username = route?.params?.username || '';
    const selectedDevice = 'Smart Band';
    const [currentStep, setCurrentStep] = useState(0);
    const [isScanning, setIsScanning] = useState(false);
    const [scannedDevices, setScannedDevices] = useState([]);
    const [isBluetoothConnected, setIsBluetoothConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isPowerConfirmed, setIsPowerConfirmed] = useState(false);
    const [isPairingComplete, setIsPairingComplete] = useState(false);

    const steps = [
        {
            title: 'Step 1',
            description: 'Press any button on the band to wake it up, then begin scanning.',
            actionLabel: isScanning ? 'Scanning...' : (isBluetoothConnected ? 'Connected' : 'Start Scanning'),
            icon: Bluetooth,
        },
        {
            title: 'Step 2',
            description: 'Confirm the band is charged and powered ON.',
            actionLabel: isPowerConfirmed ? 'Confirmed' : 'Confirm Power ON',
            icon: BatteryMedium,
        },
        {
            title: 'Step 3',
            description: 'Complete setup and continue to dashboard.',
            actionLabel: isPairingComplete ? 'Setup Complete' : 'Finish Setup',
            icon: CheckCircle2,
        },
    ];

    const titleAnim = useRef(new Animated.Value(0)).current;
    const stepAnim = useRef(new Animated.Value(0)).current;
    const buttonAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0)).current;
    const autoConnectAttemptedRef = useRef(false);

    useEffect(() => {
        const animations = [
            Animated.timing(titleAnim, {
                toValue: 1,
                duration: 350,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(stepAnim, {
                toValue: 1,
                duration: 320,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(buttonAnim, {
                toValue: 1,
                duration: 300,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ];

        Animated.sequence(animations).start();

        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 900,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 0,
                    duration: 900,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
            ])
        );

        pulseLoop.start();
        return () => pulseLoop.stop();
    }, [buttonAnim, pulseAnim, stepAnim, titleAnim]);

    useEffect(() => {
        stepAnim.setValue(0);
        Animated.timing(stepAnim, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [currentStep, stepAnim]);

    useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: (currentStep + 1) / steps.length,
            duration: 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
        }).start();
    }, [currentStep, progressAnim, steps.length]);

    const handleDeviceSelect = async (device) => {
    setIsConnecting(true);

    connectToGivenDevice(device, async (success) => {
        setIsConnecting(false);

        if (success) {

            try {
                let savedName = null;

                try {
                    savedName = await AsyncStorage.getItem('username');
                } catch (e) {
                    console.log('AsyncStorage username not found');
                }

                if (!savedName || savedName.trim() === '') {
                    savedName = username;
                }

                if (!savedName || savedName.trim() === '') {
                    savedName = 'Guest';
                }

                console.log('Sending username to band:', savedName);

                await new Promise(resolve => setTimeout(resolve, 1000));
                await writeUserName(savedName);

                console.log('Username sent successfully');
            }
            catch (err) {
                console.log('Failed to send username:', err);
            }

            setIsBluetoothConnected(true);
            setIsPowerConfirmed(true);
            setCurrentStep(2);
        }
        else {
            Alert.alert(
                "Connection Failed",
                "Could not pair or connect. Please ensure the device is on and in range."
            );
        }
    });
};

    const handleStepAction = () => {
        if (currentStep === 0) {
            if (isBluetoothConnected || isScanning || isConnecting) return;
            if (!isBleAvailable()) {
                Alert.alert(
                    "Bluetooth Unavailable",
                    "Bluetooth module isn't ready. Please rebuild the app (native) after installing BLE dependencies. If you're using Expo Go, use a custom dev client / EAS build."
                );
                return;
            }
            setIsScanning(true);
            setScannedDevices([]);
            autoConnectAttemptedRef.current = false;

            requestBluetoothPermission().then(() => {
                scanForDevices((devices) => {
                    setIsScanning(false);
                    if (devices && devices.length > 0) {
                        setScannedDevices(devices);
                        
                        // AUTO-CONNECT LOGIC: If TherapyBand is found, connect immediately
                        const therapyBand = devices.find(d => 
                            (d.name === "TherapyBand" || d.localName === "TherapyBand")
                        );
                        
                        if (therapyBand) {
                            if (autoConnectAttemptedRef.current) return;
                            autoConnectAttemptedRef.current = true;
                            handleDeviceSelect(therapyBand);
                        }
                    } else {
                        Alert.alert("No Devices Found", "Ensure the band is near, and press any button to wake it up.");
                    }
                });
            }).catch(err => {
                setIsScanning(false);
                Alert.alert("Permission Error", "Could not request Bluetooth permission.");
            });
            return;
        }

        if (currentStep === 1) {
            setIsPowerConfirmed(true);
            setCurrentStep(2);
            return;
        }

        if (currentStep === 2) {
            setIsPairingComplete(true);
        }
    };

    const canContinue = isBluetoothConnected && isPowerConfirmed && isPairingComplete;

    const progressPercent = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    });

    const activeStep = steps[currentStep];

    return (
        <GradientBackground>
            <View style={styles.container}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                >
                    <ChevronLeft color="#fff" size={24} />
                </TouchableOpacity>

                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    <Animated.View
                        style={[
                            styles.beaconWrap,
                            {
                                transform: [
                                    {
                                        scale: pulseAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [1, 1.08],
                                        }),
                                    },
                                ],
                                opacity: pulseAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.7, 1],
                                }),
                            },
                        ]}
                    >
                        <View style={styles.beaconOuter}>
                            <Bluetooth color={isBluetoothConnected ? "#26C6DA" : "#fff"} size={36} />
                        </View>
                    </Animated.View>

                    <Animated.Text
                        style={[
                            styles.title,
                            {
                                opacity: titleAnim,
                                transform: [
                                    {
                                        translateY: titleAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [18, 0],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        Instruction how to use Smart Band
                    </Animated.Text>

                    <View style={styles.stepCountWrap}>
                        <Text style={styles.stepCountText}>Step {currentStep + 1} of {steps.length}</Text>
                    </View>

                    <View style={styles.progressTrackGlobal}>
                        <Animated.View style={[styles.progressFillGlobal, { width: progressPercent }]} />
                    </View>

                    <Animated.View
                        style={[
                            styles.stepContainer,
                            {
                                opacity: stepAnim,
                                transform: [
                                    {
                                        translateY: stepAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [20, 0],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        <View style={styles.stepHeader}>
                            <View style={styles.stepBadge}>
                                {activeStep.icon && (
                                    <activeStep.icon color="#fff" size={20} />
                                )}
                            </View>
                            <Text style={styles.stepTitle}>{activeStep.title}</Text>
                        </View>
                        <Text style={styles.stepDescription}>{activeStep.description}</Text>
                        <TouchableOpacity
                            style={[
                                styles.stepActionButton,
                                ((currentStep === 0 && isScanning) || isConnecting) && styles.stepActionButtonDisabled,
                                ((currentStep === 0 && isBluetoothConnected) ||
                                    (currentStep === 1 && isPowerConfirmed) ||
                                    (currentStep === 2 && isPairingComplete)) && styles.stepActionButtonDone,
                            ]}
                            onPress={handleStepAction}
                            disabled={(currentStep === 0 && isScanning) || isConnecting}
                        >
                            <Text style={styles.stepActionButtonText}>
                                {isConnecting ? 'Connecting to Band...' : activeStep.actionLabel}
                            </Text>
                        </TouchableOpacity>

                        {currentStep === 0 && scannedDevices.length > 0 && !isBluetoothConnected && !isConnecting && (
                            <View style={styles.deviceList}>
                                <Text style={styles.deviceListTitle}>Select a device:</Text>
                                {scannedDevices.map((device, idx) => (
                                    <TouchableOpacity 
                                        key={idx} 
                                        style={styles.deviceItem}
                                        onPress={() => handleDeviceSelect(device)}
                                    >
                                        <Text style={styles.deviceName}>{device.name || device.address || "Unknown Device"}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}
                    </Animated.View>

                    <Animated.View
                        style={[
                            styles.buttonWrap,
                            {
                                opacity: buttonAnim,
                                transform: [
                                    {
                                        translateY: buttonAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [18, 0],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        <TouchableOpacity
                            style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
                            disabled={!canContinue}
                            onPress={() =>
                                navigation.navigate('Dashboard', {
                                    username,
                                    deviceName: selectedDevice,
                                    isConnected: true,
                                })
                            }
                        >
                            <Text style={styles.continueButtonText}>Continue</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </ScrollView>
            </View>
        </GradientBackground>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: SPACING.lg,
        paddingTop: 60,
    },
    backButton: {
        marginBottom: 40,
    },
    content: {
        alignItems: 'center',
        paddingBottom: 40,
    },
    stepCountWrap: {
        width: '100%',
        marginBottom: 10,
    },
    stepCountText: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 13,
        fontWeight: '600',
    },
    progressTrackGlobal: {
        width: '100%',
        height: 5,
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.18)',
        overflow: 'hidden',
        marginBottom: 22,
    },
    progressFillGlobal: {
        height: '100%',
        backgroundColor: 'rgba(255,255,255,0.95)',
    },
    beaconWrap: {
        marginTop: 20,
        marginBottom: 20,
    },
    beaconOuter: {
        width: 74,
        height: 74,
        borderRadius: 37,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    beaconInner: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: 'rgba(255,255,255,0.85)',
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#fff',
        textAlign: 'center',
        marginBottom: 40,
    },
    stepContainer: {
        width: '100%',
        marginBottom: 25,
        padding: 16,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
    },
    stepHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    stepBadge: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.15)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    stepBadgeText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
    },
    stepTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 5,
    },
    stepDescription: {
        fontSize: 16,
        color: 'rgba(255,255,255,0.8)',
        lineHeight: 24,
    },
    stepActionButton: {
        marginTop: 12,
        borderRadius: 12,
        height: 44,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    stepActionButtonDisabled: {
        opacity: 0.7,
    },
    stepActionButtonDone: {
        backgroundColor: 'rgba(38, 198, 218, 0.4)',
    },
    stepActionButtonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    continueButton: {
        backgroundColor: COLORS.secondary,
        height: 55,
        width: '100%',
        borderRadius: 27.5,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 50,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 8,
    },
    continueButtonDisabled: {
        opacity: 0.45,
    },
    buttonWrap: {
        width: '100%',
        marginTop: 25,
    },
    continueButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    deviceList: {
        marginTop: 20,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 12,
        padding: 10,
    },
    deviceListTitle: {
        color: 'rgba(255,255,255,0.7)',
        marginBottom: 10,
        fontSize: 14,
    },
    deviceItem: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        padding: 15,
        borderRadius: 8,
        marginBottom: 8,
    },
    deviceName: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    }
});

export default BluetoothScreen;
