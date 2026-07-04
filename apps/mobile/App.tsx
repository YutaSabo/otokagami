import React from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>Pronunciation Mirror</Text>
        <Text style={styles.status}>Mobile foundation ready</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f7f7f2"
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24
  },
  title: {
    color: "#17202a",
    fontSize: 28,
    fontWeight: "700"
  },
  status: {
    color: "#3f4f5f",
    fontSize: 16,
    marginTop: 12
  }
});
